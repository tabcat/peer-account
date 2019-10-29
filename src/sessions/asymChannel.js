
'use strict'
const OfferName = require('./offerName')
const Channel = require('./channel')
const Buffer = require('safe-buffer').Buffer
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  FROM_ADDRESS: 'FROM_ADDRESS',
  READY: 'READY'
}

class AsymChannel extends Channel {
  constructor (orbitdbC, db, offer, capability, options = {}) {
    super(orbitdbC, db, offer, capability, options)
    this._aes = {}
    this.status = status.PRE_INIT
    this.initialized = this.initialize()
  }

  async initialize () {
    this.status = status.INIT
    try {
      // handles fromAddress case
      if (this.offer.address && !this.offer.meta) {
        this.status = status.FROM_ADDRESS
        const db = await this._orbitdbC.openDb({
          address: this.offer.address,
          options: this.options
        })
        const { address, ...offer } = { ...this.offer, meta: db.options.meta }
        this.offer = offer
        this._state = db
      } else {
        this._state = await this._state
      }
      this._supported = this.offer.meta.supported
      this.direction = this.offer.meta.owner.id === this._capability.id
        ? 'recipient' : 'sender'
      this.status = status.READY
    } catch (e) {
      console.error(e)
    }
  }

  // session type
  static get type () { return 'asym_channel' }

  /* persistence methods */

  static async _createOffer (name, options = {}) {
    if (!options.owner || !options.curve) {
      throw new Error('missing required option fields to create offer')
    }
    return {
      type: this.type,
      name,
      accessController: options.accessController,
      meta: {
        sessionType: this.type,
        owner: options.owner,
        lifetime: options.lifetime || 604800000, // one week in ms
        supported: options.supported || [],
        curve: options.curve
      }
    }
  }

  static async verifyOffer (orbitdbC, offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.type || !offer.name || !offer.meta) return false
    if (offer.type !== this.type) return false
    return true
  }

  static async _genCapability (name, options = {}) {
    const idKey = options.idKey || name
    const identity = await this._identity(idKey, options.identityProvider)
    const curve = options.curve || 'P-256'
    const { key, jwk } = await crypto.ecdh.generateKey(curve)
    return { idKey, id: identity.id, key: [...key], jwk, curve }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (
      !capability.idKey || !capability.key ||
      !capability.jwk || !capability.curve
    ) return false
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
        identity: await this._identity(
          capability.idKey,
          orbitdbC._orbitdb.identity._provider
        ),
        accessController: offer.accessController,
        meta: offer.meta
      }
    })
    return new AsymChannel(orbitdbC, db, offer, capability, options)
  }

  static async offer (orbitdbC, options = {}) {
    const offerName = await OfferName.generate(this.type)
    const capability = await this._genCapability(
      offerName.name,
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        ...options
      }
    )
    const offer = await this._createOffer(
      offerName.name,
      {
        owner: { key: capability.key, id: capability.id },
        curve: capability.curve,
        supported: options.supported || [],
        accessController: options.accessController || { write: ['*'] }
      }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  static async accept (orbitdbC, offer, options = {}) {
    const capability = await this._genCapability(
      offer.name,
      {
        idKey: options.idKey,
        identityProvider: orbitdbC._orbitdb.identity._provider,
        curve: offer.meta.curve
      }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  static async fromAddress (orbitdbC, address, options = {}) {
    if (!orbitdbC || !address) {
      throw new Error('orbitdbC and address must be defined')
    }
    const OrbitDB = orbitdbC._orbitdb.constructor
    if (!OrbitDB.isValidAddress(address)) throw new Error('invalid address')
    const offerName = OfferName.parse(OrbitDB.parseAddress(address).path)
    if (offerName.type !== this.type) throw new Error('invalid type')
    const offer = { type: offerName.type, name: offerName.name, address }
    const capability = await this._genCapability(offer.name, options)
    return new AsymChannel(orbitdbC, null, offer, capability, options)
  }

  /* state methods */

  async sendOffer (offer) {
    await this.initialized
    if (this.direction === 'recipient') {
      throw new Error('tried to send offer as owner')
    }
    if (!this.isSupported(offer.type)) {
      throw new Error('unsupported session type')
    }
    if (!this._isValidOffer(Date.now, offer)) throw new Error('invalid offer')
    if (!offer.name) throw new Error('offer must have a name')
    if (!OfferName.isValid(offer.name)) throw new Error('invalid offer name')
    const id = OfferName.parse(offer.name).id
    if (await this.getOffer(id)) throw new Error('offer exists!')
    return this._state.put({
      [this._state.options.indexBy]: id,
      id,
      key: this._capability.key,
      timestamp: Date.now(),
      cipherbytes: [...(await this._encrypt(offer)).cipherbytes]
    })
  }

  async getOffer (id) {
    await this.initialized
    try {
      const op = await this._state.query(
        op => op.payload.value.id === id &&
        op.payload.value.key &&
        op.payload.value.timestamp &&
        op.payload.value.cipherbytes,
        { fullOp: true }
      )[0]
      if (!op) return undefined
      const offer = await this._decrypt(op.payload.value)
      const valid = this._isValidOffer(Date.now())({
        ...op,
        payload: {
          ...op.payload,
          value: {
            ...offer,
            timestamp: op.payload.value.timestamp
          }
        }
      })
      return valid
        ? { ...offer, timestamp: op.payload.value.timestamp }
        : undefined
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
        if (
          !op.payload.value.id ||
          !op.payload.value.key ||
          !op.payload.value.timestamp ||
          !op.payload.value.cipherbytes
        ) return undefined
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
          const valid = this._isValidOffer(now)(op)
          return valid ? op.payload.value : undefined
        } catch (e) {
          console.error(e)
          return undefined
        }
      })
    ).then(offers => offers.filter(offer => offer)) // remove undefined
  }

  /* encryption methods */

  async _aesKey (offer) {
    if (this._aes[offer.name]) return this._aes[offer.name]
    const ecdh = await crypto.ecdh.importKey(this._capability.jwk)
    const secret = await ecdh.genSharedKey(Buffer.from(
      this.direction === 'sender'
        ? this.offer.meta.owner.key
        : offer.key
    ))
    const aes = await crypto.aes.deriveKey(
      secret.slice(0, -12).buffer, // bytes
      secret.slice(-12).buffer, // salt
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
      console.error(e)
    }
  }

  async _decrypt (encOffer) {
    try {
      const key = await this._aesKey(encOffer)
      const decrypted = await key.decrypt(
        Buffer.from(encOffer.cipherbytes),
        OfferName.idToIv(encOffer.id)
      )
      return JSON.parse(crypto.util.ab2str(decrypted.buffer))
    } catch (e) {
      console.error(e)
    }
  }
}

module.exports = AsymChannel
