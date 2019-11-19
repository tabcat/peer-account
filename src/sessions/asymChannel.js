
'use strict'
const Channel = require('./channel')
const OfferName = require('./offerName')
const EventEmitter = require('events').EventEmitter
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  FROM_ADDRESS: 'FROM_ADDRESS',
  LISTENING: 'LISTENING',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)
const setLogOutputs = require('../utils').setLogOutputs

class AsymChannel extends Channel {
  constructor (db, offer, capability, options = {}) {
    super(db, offer, capability, options)
    this._aes = {}
    this.events = new EventEmitter()
    this.initialized = this.initialize()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, AsymChannel.type, options.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
  }

  async initialize () {
    try {
      setStatus(this, status.INIT)
      // handles fromAddress creation
      if (this.offer.address && !this.offer.meta) {
        setStatus(this, status.FROM_ADDRESS)
        const db = await this._state
        if (
          !db.options.meta ||
          !AsymChannel.verifyOffer(
            null,
            {
              name: this.offer.name,
              meta: db.options.meta
            }
          )
        ) throw new Error('something is wrong with the db meta field')
        const { address, ...offer } = { ...this.offer, meta: db.options.meta }
        this._offer = offer
        this._capability = await AsymChannel._genCapability(
          this.offer.name,
          {
            identityProvider: this.options.identityProvider,
            idKey: this.options.idKey,
            curve: this.offer.meta.curve
          }
        )
      }
      this._state = await this._state
      this.address = this._state.address
      this._supported = this.offer.meta.supported
      this.direction = this.offer.meta.owner.id === this.capability.id
        ? 'recipient' : 'sender'
      this._state.events.on('replicated', () => this.events.emit('update'))
      this._state.events.on('write', () => this.events.emit('update'))
      setStatus(this, status.LISTENING)
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
    }
  }

  // session type
  static get type () { return 'asym_channel' }

  /* persistence methods */

  static async _createOffer (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (!options.owner || !options.owner.id || !options.owner.key) {
      throw new Error('missing required option fields to create offer')
    }

    return {
      name: offerName.name,
      meta: {
        sessionType: this.type,
        owner: options.owner,
        lifetime: options.lifetime || 604800000, // one week in ms
        supported: options.supported || [],
        curve: options.curve || 'P-256'
      }
    }
  }

  static async verifyOffer (orbitdbC, offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name || !offer.meta) return false
    if (OfferName.parse(offer.name).type !== this.type) return false
    const { meta } = offer
    if (meta.sessionType !== this.type) return false
    if (!meta.owner || !meta.lifetime || !meta.supported || !meta.curve) {
      return false
    }
    return true
  }

  static async _genCapability (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    const idKey = options.idKey || offerName.name
    const identity = await this._identity(idKey, options.identityProvider)
    const curve = options.curve || 'P-256'
    const { key, jwk } = await crypto.ecdh.generateKey(curve)
    return { idKey, id: identity.id, key: [...key], jwk, curve }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (
      !capability.idKey || !capability.id || !capability.key ||
      !capability.jwk || !capability.curve
    ) return false
    return true
  }

  /* factory methods */

  static async open (orbitdbC, offer, capability, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    if (!capability) throw new Error('capability must be defined')
    if (!await this.verifyOffer(orbitdbC, offer)) {
      throw new Error(`tried to open ${this.type} session with invalid offer`)
    }
    if (!await this.verifyCapability(capability)) {
      throw new Error(
        `tried to open ${this.type} session with invalid capability`
      )
    }
    const db = orbitdbC.openDb({
      name: offer.name,
      type: 'docstore',
      options: {
        identity: await this._identity(
          capability.idKey,
          orbitdbC._orbitdb.identity._provider
        ),
        accessController: { write: ['*'] },
        meta: offer.meta
      }
    })
    return new AsymChannel(db, offer, capability, { log: options.log })
  }

  static async offer (orbitdbC, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    const offerName = await OfferName.generate(this.type)
    const capability = await this._genCapability(
      offerName,
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey,
        curve: options.curve
      }
    )
    const offer = await this._createOffer(
      offerName,
      {
        owner: { key: capability.key, id: capability.id },
        curve: capability.curve,
        supported: options.supported || []
      }
    )
    return this.open(orbitdbC, offer, capability, { log: options.log })
  }

  static async accept (orbitdbC, offer, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    const capability = await this._genCapability(
      offer.name,
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey,
        curve: offer.meta.curve
      }
    )
    return this.open(orbitdbC, offer, capability, { log: options.log })
  }

  static async fromAddress (orbitdbC, address, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!address) throw new Error('address must be defined')
    if (!orbitdbC.isValidAddress(address)) throw new Error('invalid address')

    const offerName = OfferName.parse(orbitdbC.parseAddress(address).path)
    if (offerName.type !== this.type) {
      throw new Error(
        `offer type was ${offerName.type}, expected ${this.type}`
      )
    }
    const offer = { name: offerName.name, address: address.toString() }
    const db = orbitdbC.openDb({ address: offer.address })
    return new AsymChannel(
      db,
      offer,
      null,
      {
        log: options.log,
        identityProvider: orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey
      }
    )
  }

  /* state methods */

  async sendOffer (offer) {
    await this.initialized
    if (!offer) throw new Error('offer must be defined')
    if (this.direction === 'recipient') {
      throw new Error('tried to send offer as owner')
    }
    if (!offer.name) throw new Error('offer must have a name')
    const offerName = OfferName.parse(offer.name)
    if (!this.isSupported(offerName.type)) {
      throw new Error('unsupported session type')
    }
    if (!offer._channel) {
      offer._channel = {
        name: this.offer.name,
        address: this._state.address.toString(),
        timestamp: Date.now()
      }
    }

    const offerId = offerName.id
    if (await this.getOffer(offerId)) throw new Error('offer already exists!')
    const encryptedOffer = await this._encrypt(offer)

    return this._state.put({
      [this._state.options.indexBy]: offerId,
      id: offerId,
      key: this.capability.key,
      cipherbytes: [...encryptedOffer.cipherbytes]
    })
  }

  async getOffer (offerId) {
    try {
      await this.initialized
      if (!offerId) throw new Error('offerId must be defined')
      if (!OfferName.isValidId(offerId)) throw new Error('invalid offerId')
      const op = await this._state.query(
        op =>
          (
            this.direction === 'recipient' ||
            op.identity.id === this.capability.id
          ) &&
          op.payload.key === offerId &&
          op.payload.value.id === offerId &&
          op.payload.value.key &&
          op.payload.value.cipherbytes,
        { fullOp: true }
      )[0]
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
        OfferName.isValidId(op.payload.key) &&
        op.payload.key === op.payload.value.id &&
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

  /* encryption methods */

  async _aesKey (offer) {
    if (this._aes[offer.name]) return this._aes[offer.name]
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
    this._aes[offer.name] = aes
    return aes
  }

  async _encrypt (offer) {
    try {
      const key = await this._aesKey(offer)
      return key.encrypt(
        crypto.util.str2ab(JSON.stringify(offer)),
        OfferName.parse(offer.name).iv
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
        OfferName.idToIv(encOffer.id)
      )
      return JSON.parse(crypto.util.ab2str(decrypted.buffer))
    } catch (e) {
      this.log.error(e)
    }
  }
}

module.exports = AsymChannel
