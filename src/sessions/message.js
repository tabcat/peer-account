
'use strict'
const Session = require('./session')
const SessionName = require('./sessionName')
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class Message extends Session {
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
        type: 'feed',
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
      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Message.type} failed initialization`)
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

    const aesKey = await crypto.aes.importKey(new Uint8Array(capability.aes))
    const keyCheck = await aesKey.encrypt(
      crypto.util.str2ab(this.type),
      SessionName.parse(capability.name).iv
    )

    return {
      name: capability.name,
      aes: capability.aes,
      sender: options.sender || capability.id,
      recipient: options.recipient,
      meta: {
        sessionType: this.type,
        keyCheck: [...keyCheck.cipherbytes]
      }
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name || !SessionName.isValid(offer.name)) return false
    if (SessionName.parse(offer.name).type !== this.type) return false
    if (
      !offer.aes || !offer.sender || !offer.recipient || !offer.meta
    ) return false
    const { meta } = offer
    if (!meta.sessionType || !meta.keyCheck) return false
    const key = await crypto.aes.importKey(new Uint8Array(offer.aes))
    return Boolean(
      await key.decrypt(
        new Uint8Array(offer.meta.keyCheck),
        SessionName.parse(offer.name).iv
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
      : options.name || SessionName.generate(this.type).toString()
    const aesKey = fromOffer
      ? await crypto.aes.importKey(new Uint8Array(options.offer.aes))
      : options.aesKey || await crypto.aes.generateKey(options.keyLen || 128)

    const idKey = options.idKey || name
    const identity = await this._identity(idKey, options.identityProvider)
    const rawKey = await crypto.aes.exportKey(aesKey)

    return { name, idKey, id: identity.id, aes: [...rawKey] }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.name || !SessionName.isValid(capability.name)) return false
    if (SessionName.parse(capability.name).type !== this.type) return false
    if (!capability.idKey || !capability.id) return false
    if (!capability.aes) return false
    return true
  }

  async sendMessage (msg) {
    await this.initialized
    if (!msg) throw new Error('msg must be defined')

    const envelope = {
      msg,
      _session: {
        name: this.offer.name,
        address: this._state.address.toString()
      }
    }
    const { cipherbytes, iv } = await this._encrypt(envelope)

    return this._state.add({
      cipherbytes: [...cipherbytes],
      iv: [...iv]
    })
  }

  async readMessages (options) {
    const events = await this._state.iterator(options).collect()
    return Promise.all(
      events.map(async (e) => {
        if (
          !Array.isArray(e.payload.value.cipherbytes) &&
          !Array.isArray(e.payload.value.iv)
        ) return undefined
        const [cipherbytes, iv] = ['cipherbytes', 'iv']
          .map((k) => new Uint8Array(e.payload.value[k]))
        const value = await this._decrypt(cipherbytes, iv)
          .catch(e => { this.log.error(e); return undefined })
        return { ...e, payload: { ...e.payload, value } }
      })
    ).then(events => events.filter(x => x !== undefined))
  }

  async _aesKey () {
    if (this._aes) return this._aes
    this._aes = await crypto.aes.importKey(new Uint8Array(this.offer.aes))
    return this._aes
  }

  async _encrypt (msg, iv) {
    try {
      const key = await this._aesKey()
      iv = iv || crypto.randomBytes(12)
      return key.encrypt(
        crypto.util.str2ab(JSON.stringify(msg)),
        iv
      )
    } catch (e) {
      this.log.error(e)
    }
  }

  async _decrypt (cipherbytes, iv) {
    try {
      const key = await this._aesKey()
      const decrypted = await key.decrypt(cipherbytes, iv)
      return JSON.parse(crypto.util.ab2str(decrypted.buffer))
    } catch (e) {
      this.log.error(e)
    }
  }
}

module.exports = Message
