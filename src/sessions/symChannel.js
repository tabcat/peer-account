
'use strict'
const Channel = require('./channel')
const SessionId = require('./sessionId')
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  LISTENING: 'LISTENING',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class SymChannel extends Channel {
  constructor (orbitdbC, offer, capability, options = {}) {
    super(orbitdbC, offer, capability, options)
    this._aes = null
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      this._state = await this._orbitdbC.openDb({
        name: this.offer.sessionId,
        type: 'docstore',
        options: {
          identity: await this.constructor._identity(
            this.capability.idKey,
            this._orbitdbC._orbitdb.identity._provider
          ),
          accessController: {
            write: [this.offer.sender, this.offer.recipient]
          },
          meta: this.offer.meta
        }
      })
      this._supported = this.offer.meta.supported
      this._state.events.on('replicated', () => this.events.emit('replicated'))
      this._state.events.on('write', () => this.events.emit('write'))
      setStatus(this, status.LISTENING)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${SymChannel.type} failed initialization`)
    }
  }

  static get type () { return 'sym_channel' }

  async sendOffer (offer) {
    await this.initialized
    if (!offer) throw new Error('offer must be defined')
    if (!offer.sessionId) throw new Error('offer must have a sessionId')
    const sessionId = SessionId.parse(offer.sessionId)
    if (!this.isSupported(sessionId.type)) {
      throw new Error('unsupported session type')
    }
    if (!offer._channel) {
      offer._channel = {
        sessionId: this.offer.sessionId,
        address: this._state.address.toString(),
        timestamp: Date.now()
      }
    }

    const pos = SessionId.parse(offer.sessionId).pos
    if (await this.getOffer(pos)) throw new Error('offer already exists!')
    const encryptedOffer = await this._encrypt(offer)

    return this._state.put({
      [this._state.options.indexBy]: pos,
      sessionPos: pos,
      cipherbytes: [...encryptedOffer.cipherbytes]
    })
  }

  async getOffer (pos) {
    try {
      await this.initialized
      if (!pos) throw new Error('pos must be defined')
      if (!SessionId.isValidPos(pos)) throw new Error('invalid pos')
      const [op] = await this._state.query(
        op =>
          op.payload.key === pos &&
          op.payload.value.sessionPos === pos &&
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
        SessionId.isValidPos(op.payload.key) &&
        op.payload.key === op.payload.value.sessionPos &&
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
    ).then(offers => offers.filter(offer => offer))
  }

  async _aesKey () {
    if (this._aes) return this._aes
    this._aes = await crypto.aes.importKey(new Uint8Array(this.offer.aes))
    return this._aes
  }

  async _encrypt (offer) {
    try {
      const key = await this._aesKey()
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
      const key = await this._aesKey()
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
    if (!options.recipient) {
      throw new Error('options.recipient must be defined')
    }

    const aesKey = await crypto.aes.importKey(new Uint8Array(capability.aes))
    const keyCheck = await aesKey.encrypt(
      crypto.util.str2ab(this.type),
      SessionId.parse(capability.sessionId).iv
    )

    return {
      sessionId: capability.sessionId,
      aes: capability.aes,
      sender: options.sender || capability.id,
      recipient: options.recipient,
      meta: {
        sessionType: this.type,
        lifetime: options.lifetime || 604800000, // one week in ms
        supported: options.supported || [],
        keyCheck: [...keyCheck.cipherbytes]
      }
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.sessionId || !SessionId.isValid(offer.sessionId)) return false
    if (SessionId.parse(offer.sessionId).type !== this.type) return false
    if (
      !offer.aes || !offer.sender || !offer.recipient || !offer.meta
    ) return false
    const { meta } = offer
    if (
      !meta.sessionType || !meta.lifetime || !meta.supported || !meta.keyCheck
    ) return false
    const key = await crypto.aes.importKey(new Uint8Array(offer.aes))
    return Boolean(
      await key.decrypt(
        new Uint8Array(offer.meta.keyCheck),
        SessionId.parse(offer.sessionId).iv
      ).catch(e => {
        console.error(e)
        console.error('offer failed keyCheck')
        return false
      })
    )
  }

  static async createCapability (options = {}) {
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    const fromOffer = options.offer && await this.verifyOffer(options.offer)

    const sessionId = fromOffer
      ? options.offer.sessionId
      : options.sessionId || SessionId.generate(this.type).toString()
    const aesKey = fromOffer
      ? await crypto.aes.importKey(new Uint8Array(options.offer.aes))
      : options.aesKey || await crypto.aes.generateKey(options.keyLen || 128)

    const idKey = options.idKey || sessionId
    const identity = await this._identity(idKey, options.identityProvider)
    const rawKey = await crypto.aes.exportKey(aesKey)

    return { sessionId, idKey, id: identity.id, aes: [...rawKey] }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.sessionId || !SessionId.isValid(capability.sessionId)) return false
    if (SessionId.parse(capability.sessionId).type !== this.type) return false
    if (!capability.idKey || !capability.id) return false
    if (!capability.aes) return false
    return true
  }
}

module.exports = SymChannel
