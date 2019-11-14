
'use strict'
const Channel = require('./channel')
const OfferName = require('./offerName')
const EventEmitter = require('events').EventEmitter
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  LISTENING: 'LISTENING',
  FAILED: 'FAILED'
}
const setStatus = require('./utils').setStatus(status)
const setLogOutputs = require('./utils').setLogOutput

class SymChannel extends Channel {
  constructor (db, offer, capability, options = {}) {
    super(db, offer, capability, options)
    this._aes = null
    this.events = new EventEmitter()
    this.initialized = this._initialize()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, SymChannel.type, options.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      this._state = await this._state
      this._state.events.on('replicated', () => this.events.emit('update'))
      this._state.events.on('write', () => this.events.emit('update'))
      setStatus(this, status.LISTENING)
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
    }
  }

  // session type
  static get type () { return 'sym_channel' }

  /* persistence methods */

  static async _createOffer (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (!options.aesKey || !options.sender || !options.recipient) {
      throw new Error('missing required option fields to create offer')
    }
    const rawKey = await crypto.aes.exportKey(options.aesKey)
    const keyCheck = await options.key.encrypt(
      crypto.util.str2ab(this.type),
      offerName.iv
    )

    return {
      name: offerName.name,
      aes: [...rawKey],
      sender: options.sender,
      recipient: options.recipient,
      meta: {
        sessionType: this.type,
        lifetime: options.lifetime || 604800000, // one week in ms
        supported: options.supported || [],
        keyCheck: [...keyCheck.cipherbytes]
      }
    }
  }

  static async verifyOffer (orbitdbC, offer) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name) return false
    const offerName = OfferName.parse(offer.name)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (
      !offer.sender || !offer.recipient || !offer.aes || !offer.meta
    ) return false
    const { meta } = offer
    if (
      meta.sessionType || meta.lifetime || meta.supported || meta.keyCheck
    ) return false
    const key = await crypto.aes.importKey(new Uint8Array(offer.aes))
    return !!await key.decrypt(
      new Uint8Array(offer.meta.keyCheck),
      offerName.iv
    ).catch(e => { console.log(e); return false })
  }

  static async _genCapability (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    const idKey = options.idKey || offerName.name
    const identity = await this._identity(idKey)
    return { idKey, id: identity.id }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.idKey || !capability.id) return false
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
        accessController: { write: [offer.sender, offer.recipient] },
        meta: offer.meta
      }
    })
    return new SymChannel(db, offer, capability, { log: options.log })
  }

  static async offer (orbitdbC, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!options.recipient) throw new Error('recipient option must be defined')
    const keyLen = options.keyLen || '128'
    const offerName = OfferName.generate(this.type)
    const capability = await this._genCapability(
      offerName,
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey
      }
    )
    const offer = await this._createOffer(
      offerName,
      {
        key: options.key || await crypto.aes.generateKey(keyLen, this.type),
        sender: capability.id,
        recipient: options.recipient,
        supported: options.supported
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
        idKey: options.idKey
      }
    )
    return this.open(orbitdbC, offer, capability, { log: options.log })
  }

  /* state methods */

  async sendOffer (offer) {
    await this.initialized
    if (!offer) throw new Error('offer must be defined')
    if (!this._isSupported(offer.type)) {
      throw new Error('unsupported session type')
    }
    if (!offer.name) throw new Error('offer must have a name')
    if (!OfferName.isValid(offer.name)) throw new Error('invalid offer name')

    const offerId = OfferName.parse(offer.name).id
    if (!offer._channel) {
      offer._channel = {
        address: this._state.address.toString(),
        timestamp: Date.now()
      }
    }

    if (!this._isValidOffer(Date.now(), offer)) {
      throw new Error('tried to send invalid offer')
    }

    if (await this.getOffer(offerId)) throw new Error('offer already exists!')
    const encryptedOffer = await this._encrypt(offer)
    return this._state.put({
      [this._state.options.indexBy]: offerId,
      id: offerId,
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
          op.payload.key === offerId &&
          op.payload.value.id === offerId &&
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
        OfferName.isValidId(op.payload.key) &&
        op.payload.key === op.payload.value.id &&
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

  /* encryption methods */

  async _aesKey () {
    if (this._aes) return this._aes
    this._aes = await crypto.aes.importKey(this.capability.aes)
    return this._aes
  }

  async _encrypt (offer) {
    try {
      const key = await this._aesKey()
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
      const key = await this._aesKey()
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

module.exports = SymChannel
