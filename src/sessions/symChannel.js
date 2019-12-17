
'use strict'
const Channel = require('./channel')
const OfferName = require('../offerName')
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
        name: this.offer.name,
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
      this._state.events.on('replicated', () => this.events.emit('update'))
      this._state.events.on('write', () => this.events.emit('update'))
      setStatus(this, status.LISTENING)
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
    }
  }

  static get type () { return 'sym_channel' }

  static async createOffer (capability, options = {}) {
    if (!this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }
    if (!options.recipient) {
      throw new Error('options.recipient must be defined')
    }

    const aesKey = await crypto.aes.importKey(capability.aes)
    const keyCheck = await aesKey.encrypt(
      crypto.util.str2ab(this.type),
      OfferName.parse(capability.name).iv
    )

    return {
      name: capability.name,
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
    if (!offer.name || !OfferName.isValid(offer.name)) return false
    if (OfferName.parse(offer.name).type !== this.type) return false
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
        OfferName.parse(offer.name).iv
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

    const name = fromOffer
      ? options.offer.name
      : options.name || OfferName.generate(this.type).toString()
    const aesKey = fromOffer
      ? await crypto.aes.importKey(options.offer.aes)
      : options.aesKey || await crypto.aes.generateKey(options.keyLen || 128)

    const idKey = options.idKey || name
    const identity = await this._identity(idKey, options.identityProvider)
    const rawKey = await crypto.aes.exportKey(aesKey)

    return { name, idKey, id: identity.id, aes: [...rawKey] }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.name || !OfferName.isValid(capability.name)) return false
    if (OfferName.parse(capability.name).type !== this.type) return false
    if (!capability.idKey || !capability.id) return false
    if (!capability.aes) return false
    return true
  }

  async sendOffer (offer) {
    await this.initialized
    if (!offer) throw new Error('offer must be defined')
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

    const offerId = OfferName.parse(offer.name).id
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

  async _aesKey () {
    if (this._aes) return this._aes
    this._aes = await crypto.aes.importKey(this.offer.aes)
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
