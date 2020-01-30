
'use strict'
const Session = require('../session')
const SessionId = require('../sessionName')
const Index = require('../../encryptedIndex')
const crypto = require('@tabcat/peer-account-crypto')

class Component extends Session {
  constructor (p2p, offer, capability, options) {
    super(p2p, offer, capability, options)
    this._account = p2p._orbitdbC ? p2p : null
  }

  static get type () { return 'component' }

  async _attachState () {
    if (this._state !== null) { return }
    const aesKey = await Index.importKey(new Uint8Array(this.offer.aes))
    const dbAddr = await Index.determineAddress(
      this._orbitdbC._orbitdb,
      {
        sessionId: this.offer.sessionId,
        options: {
          ...this.options,
          accessController: {
            write: [this.offer.meta.owner.id]
          },
          meta: this.offer.meta
        }
      },
      aesKey
    )
    this._state = await Index.open(
      this._orbitdbC,
      dbAddr,
      aesKey,
      {
        identity: await this.constructor._identity(
          this.capability.idKey,
          this._orbitdbC._orbitdb.identity._provider
        )
      }
    )
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

  static async createOffer (capability, options = {}) {
    if (!this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }

    const aesKey = await crypto.aes.importKey(new Uint8Array(capability.aes))
    const keyCheck = await aesKey.encrypt(
      crypto.util.str2ab(this.type),
      SessionId.parse(capability.sessionId).iv
    )

    return {
      sessionId: capability.sessionId,
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
    if (!offer.sessionId || !SessionId.isValid(offer.sessionId)) return false
    if (SessionId.parse(offer.sessionId).type !== this.type) return false
    if (!offer.aes || !offer.meta) return false
    const { meta } = offer
    if (!meta.sessionType || !meta.keyCheck || !meta.owner) return false
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
      ? await crypto.aes.importKey(options.offer.aes)
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

module.exports = Component
