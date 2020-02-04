
'use strict'
const Channel = require('./channel')
const SessionId = require('./sessionId')
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  FROM_ADDRESS: 'FROM_ADDRESS',
  LISTENING: 'LISTENING',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class AsymChannel extends Channel {
  constructor (orbitdbC, offer, capability, options = {}) {
    super(orbitdbC, offer, capability, options)
    this._aes = {}
    this.initialized = this.initialize()
  }

  async initialize () {
    try {
      setStatus(this, status.INIT)
      // handles fromAddress creation
      if (this.offer.address && !this.offer.meta) {
        setStatus(this, status.FROM_ADDRESS)
        const db = await this._orbitdbC.openDb({ address: this.offer.address })
        if (
          !db.options.meta ||
          !AsymChannel.verifyOffer(
            {
              sessionId: this.offer.sessionId,
              meta: db.options.meta
            }
          )
        ) throw new Error('something is wrong with the db meta field')
        const { address, ...offer } = { ...this.offer, meta: db.options.meta }
        this._offer = offer
        this._capability = await AsymChannel.createCapability(
          {
            identityProvider: this._orbitdbC._orbitdb.identity._provider,
            ...this.options,
            offer
          }
        )
      }

      this._state = await this._orbitdbC.openDb({
        name: this.offer.sessionId,
        type: 'docstore',
        options: {
          identity: await this.constructor._identity(
            this.capability.idKey,
            this._orbitdbC._orbitdb.identity._provider
          ),
          accessController: { write: ['*'] },
          meta: this.offer.meta
        }
      })
      this._supported = this.offer.meta.supported
      this.direction = this.offer.meta.owner.id === this.capability.id
        ? 'recipient' : 'sender'

      this._state.events.on('replicated', () => this.events.emit('replicated'))
      this._state.events.on('write', () => this.events.emit('write'))
      setStatus(this, status.LISTENING)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${AsymChannel.type} failed initialization`)
    }
  }

  static get type () { return 'asym_channel' }

  static async fromAddress (orbitdbC, address, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!address) throw new Error('address must be defined')
    if (!orbitdbC.isValidAddress(address)) throw new Error('invalid address')

    const sessionId = SessionId.parse(orbitdbC.parseAddress(address).path)
    if (sessionId.type !== this.type) {
      throw new Error(
        `offer type was ${sessionId.type}, expected ${this.type}`
      )
    }
    const offer = { sessionId: sessionId.toString(), address: address.toString() }
    return new AsymChannel(orbitdbC, offer, null, options)
  }

  async address () {
    await this.initialized
    return this._state.address
  }

  async sendOffer (offer) {
    await this.initialized
    if (!offer) throw new Error('offer must be defined')
    if (this.direction === 'recipient') {
      throw new Error('tried to send offer as owner')
    }
    if (!offer.sessionId) throw new Error('offer must have a sessionId')
    const sessionId = SessionId.parse(offer.sessionId)
    if (!this.isSupported(sessionId.type)) {
      throw new Error('unsupported session type')
    }
    offer = {
      ...offer,
      _channel: {
        sessionId: this.offer.sessionId,
        address: this._state.address.toString(),
        timestamp: Date.now()
      }
    }

    const sessionPos = sessionId.pos
    if (await this.getOffer(sessionPos)) throw new Error('offer already exists!')
    const encryptedOffer = await this._encrypt(offer)

    return this._state.put({
      [this._state.options.indexBy]: sessionPos,
      sessionPos: sessionPos,
      key: this.capability.key,
      cipherbytes: [...encryptedOffer.cipherbytes]
    })
  }

  async getOffer (sessionPos) {
    try {
      await this.initialized
      if (!sessionPos) throw new Error('sessionPos must be defined')
      if (!SessionId.isValidPos(sessionPos)) throw new Error('invalid sessionPos')
      const [op] = await this._state.query(
        op =>
          (
            this.direction === 'recipient' ||
            op.identity.id === this.capability.id
          ) &&
          op.payload.key === sessionPos &&
          op.payload.value.sessionPos === sessionPos &&
          op.payload.value.key &&
          op.payload.value.cipherbytes,
        { fullOp: true }
      )
      if (!op) return undefined
      const offer = await this._decrypt(op.payload.value)
      const valid = this._isValidOffer(Date.now())(
        { ...op, payload: { ...op.payload, value: offer } }
      )
      return valid ? offer : undefined
    } catch (e) {
      this.log.error(e)
      return undefined
    }
  }

  async getOffers () {
    await this.initialized
    const now = Date.now()
    const ops = await this._state.query(
      op =>
        (
          this.direction === 'recipient' ||
          op.identity.id === this.capability.id
        ) &&
        SessionId.isValidPos(op.payload.key) &&
        op.payload.key === op.payload.value.sessionPos &&
        op.payload.value.key &&
        op.payload.value.cipherbytes,
      { fullOp: true }
    )
    return Promise.all(
      ops.map(async (op) => {
        try {
          const offer = await this._decrypt(op.payload.value)
          const valid = this._isValidOffer(now)(
            { ...op, payload: { ...op.payload, value: offer } }
          )
          return valid ? offer : undefined
        } catch (e) {
          this.log.error(e)
          return undefined
        }
      })
    ).then(offers => offers.filter(offer => offer)) // remove undefined
  }

  async _aesKey (offer) {
    if (this._aes[offer.sessionId]) return this._aes[offer.sessionId]
    const ecdh = await crypto.ecdh.importKey(this.capability.jwk)
    const secret = await ecdh.genSharedKey(new Uint8Array(
      this.direction === 'sender'
        ? this.offer.meta.owner.key
        : offer.key
    ))
    const aes = await crypto.aes.deriveKey(
      secret.slice(0, -12), // bytes
      secret.slice(-12), // salt
      128 // key length
    )
    this._aes[offer.sessionId] = aes
    return aes
  }

  async _encrypt (offer) {
    try {
      const key = await this._aesKey(offer)
      return key.encrypt(
        crypto.util.str2ab(JSON.stringify(offer)),
        SessionId.parse(offer.sessionId).iv
      )
    } catch (e) {
      this.log.error(e)
    }
  }

  async _decrypt (encOffer) {
    try {
      const key = await this._aesKey(encOffer)
      const decrypted = await key.decrypt(
        new Uint8Array(encOffer.cipherbytes),
        SessionId.posToIv(encOffer.sessionPos)
      )
      return JSON.parse(crypto.util.ab2str(decrypted.buffer))
    } catch (e) {
      this.log.error(e)
    }
  }

  static async createOffer (capability, options = {}) {
    if (!this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }

    return {
      sessionId: capability.sessionId.toString(),
      meta: {
        sessionType: this.type,
        owner: { id: capability.id, key: capability.key },
        lifetime: options.lifetime || 604800000, // one week in ms
        supported: options.supported || [],
        curve: capability.curve
      }
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.sessionId || !SessionId.isValid(offer.sessionId)) return false
    if (SessionId.parse(offer.sessionId).type !== this.type) return false
    if (!offer.meta) return false
    const { meta } = offer
    if (meta.sessionType !== this.type) return false
    if (
      !meta.owner || !meta.lifetime || !meta.supported || !meta.curve
    ) return false
    return true
  }

  static async createCapability (options = {}) {
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    const fromOffer = options.offer && await this.verifyOffer(options.offer)

    const sessionId = fromOffer
      ? options.offer.sessionId
      : options.sessionId || SessionId.generate(this.type)
    const curve = fromOffer
      ? options.offer.meta.curve
      : options.curve || 'P-256'

    const idKey = options.idKey || sessionId
    const identity = await this._identity(idKey, options.identityProvider)
    const { key, jwk } = await crypto.ecdh.generateKey(curve)

    return {
      sessionId: sessionId.toString(),
      idKey,
      id: identity.id,
      key: [...key],
      jwk,
      curve
    }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.sessionId || !SessionId.isValid(capability.sessionId)) return false
    if (SessionId.parse(capability.sessionId).type !== this.type) return false
    if (
      !capability.idKey || !capability.id || !capability.key ||
      !capability.jwk || !capability.curve
    ) return false
    return true
  }
}

module.exports = AsymChannel
