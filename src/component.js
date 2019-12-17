
'use strict'
const Session = require('./session')
const OfferName = require('./offerName')
const crypto = require('@tabcat/peer-account-crypto')

class Component extends Session {
  static get type () { return 'component' }

  static async createOffer (capability, options = {}) {
    if (!this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }

    const aesKey = await crypto.aes.importKey(capability.aes)
    const keyCheck = await aesKey.encrypt(
      crypto.util.str2ab(this.type),
      OfferName.parse(capability.name).iv
    )

    return {
      name: capability.name,
      aes: capability.aes,
      meta: {
        sessionType: this.type,
        owner: { id: capability.id },
        keyCheck: [...keyCheck.cipherbytes]
      }
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name || !OfferName.isValid(offer.name)) return false
    if (OfferName.parse(offer.name).type !== this.type) return false
    if (!offer.aes || !offer.meta) return false
    const { meta } = offer
    if (!meta.sessionType || !meta.keyCheck || !meta.owner) return false
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

  async _matchRecord (recordId) {
    return this._state.match(recordId)
  }

  async _getRecords (recordType) {
    return this._state.get(recordType)
  }

  async _setRecord (key, value) {
    return this._state.set(key, value)
  }

  async _queryRecords (mapper, prefix = '') {
    if (typeof mapper !== 'function') {
      throw new Error('mapper must be type function')
    }
    return this._state.query(doc =>
      doc[this._state._indexBy].startsWith(prefix) &&
      mapper(doc)
    )
  }
}

module.exports = Component
