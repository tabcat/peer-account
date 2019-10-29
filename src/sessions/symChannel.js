
'use strict'
const Channel = require('./channel')
const Buffer = require('safe-buffer').Buffer
const crypto = require('@tabcat/peer-account-crypto')
const { ivFromName } = require('./utils')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY'
}

class SymChannel extends Channel {
  constructor (orbitdbC, db, offer, capability, options = {}) {
    super(orbitdbC, db, offer, capability)
    this._supported = offer.meta.supported
    this.status = status.PRE_INIT
    this.initialized = this._initialize()
  }

  async _initialize () {
    this.status = status.INIT
    try {
      this._state = await this._state
      this.status = status.READY
    } catch (e) {
      console.error(e)
    }
  }

  // session type
  static get type () { return 'sym_channel' }

  /* persistence methods */

  static async _createOffer (offerName, options = {}) {
    if (!options.key || !options.sender || !options.recipient) {
      throw new Error('missing required option fields to create offer')
    }
    const { key } = options
    return {
      type: this.type,
      name: offerName,
      aes: [...Buffer.from(await crypto.aes.exportKey(key))],
      sender: options.sender,
      recipient: options.recipient,
      meta: {
        sessionType: this.type,
        lifetime: options.lifetime || 604800000, // one week in ms
        supported: options.supported || [],
        keyCheck: [...(await key.encrypt(
          Buffer.from(this.type),
          ivFromName(offerName)
        )).cipherbytes]
      }
    }
  }

  static async verifyOffer (orbitdbC, offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.type || !offer.name) return false
    if (offer.type !== this.type) return false
    if (!offer.sender || !offer.recipient || !offer.aes) return false
    if (
      !offer.meta || !offer.meta.sessionType || !offer.meta.lifetime ||
      !offer.meta.supported || !offer.meta.keyCheck
    ) return false
    try {
      const key = await crypto.aes.importKey(Buffer.from(offer.aes))
      await key.decrypt(
        Buffer.from(offer.meta.keyCheck),
        ivFromName(offer.name)
      )
      return true
    } catch (e) {
      console.error(e)
      return false
    }
  }

  static async _genCapability (offerName, options = {}) {
    const idKey = options.idKey || offerName
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
    if (!await this.verifyOffer(orbitdbC, offer)) {
      throw new Error('invalid offer')
    }
    if (!await this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }
    const db = orbitdbC.openDb({
      name: offer.name,
      type: 'docstore',
      options: {
        ...options,
        identity: await this._identity(capability.idKey),
        meta: offer.meta,
        accessController: { write: [offer.sender, offer.recipient] }
      }
    })
    return new SymChannel(orbitdbC, db, offer, capability, options)
  }

  static async offer (orbitdbC, options = {}) {
    if (!options.recipient) throw new Error('recipient option must be defined')
    const keyLen = options.keyLen || '128'
    const { name } = await this._genOfferName()
    const capability = await this._genCapability(name, options)
    const offer = await this._createOffer(
      name,
      {
        key: await crypto.aes.genKey(keyLen, this.type),
        sender: capability.id,
        recipient: options.recipient,
        supported: options.supported
      }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  static async accept (orbitdbC, offer, options = {}) {
    const capability = await this._genCapability(
      offer.name,
      { idKey: options.idKey }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  /* state methods */

  async sendOffer (offer) {
    await this.initialized
    if (!this._isSupported(offer.type)) {
      throw new Error('unsupported session type')
    }
    if (!this._isValidOffer(Date.now, offer)) throw new Error('invalid offer')
    if (await this.getOffer(offer.name)) throw new Error('offer exists')
    return this._state.put({
      [this._state.options.indexBy]: offer.name,
      name: offer.name,
      type: offer.type,
      timestamp: Date.now(),
      cipherbytes: [...(await this._encrypt(offer)).cipherbytes]
    })
  }

  async getOffer (offerName) {
    await this.initialized
    try {
      const op = await this._state.query(
        op => op.payload.value.name === offerName,
        { fullOp: true }
      )[0]
      if (!op) return undefined
      const offer = await this._decrypt(op.payload.value)
      return this._isValidOffer(Date.now())({
        ...op,
        payload: {
          ...op.payload,
          value: {
            ...offer,
            timestamp: op.payload.value.timestamp
          }
        }
      }) ? offer : undefined
    } catch (e) {
      console.error(e)
      return undefined
    }
  }

  async getOffers () {
    await this.initialized
    const now = Date.now()
    const ops = await this._state.query(() => true, { fullOp: true })
    return Promise.all(
      ops.map(async (op) => {
        try {
          op = {
            ...op,
            payload: {
              ...op.payload,
              value: {
                ...await this._decrypt(op.payload.value),
                timestamp: op.payload.value.timestamp
              }
            }
          }
          return this._isValidOffer(now)(op) ? op.payload.value : undefined
        } catch (e) {
          return undefined
        }
      })
    ).then(offers => offers.filter(offer => offer))
  }

  /* encryption methods */

  async _aesKey () {
    if (this._aes) return this._aes
    this._aes = await crypto.aes.importKey(this._capability.aes)
    return this._aes
  }

  async _encrypt (offer) {
    try {
      const key = await this._aesKey()
      return key.encrypt(
        Buffer.from(JSON.stringify(offer)),
        ivFromName(offer.name)
      )
    } catch (e) {
      this.events.emit('error', e)
    }
  }

  async _decrypt (encOffer) {
    try {
      const key = await this._aesKey()
      return JSON.parse(await key.decrypt(
        Buffer.from(encOffer.cipherbytes),
        ivFromName(encOffer.name)
      ))
    } catch (e) {
      this.events.emit('error', e)
    }
  }
}

module.exports = SymChannel
