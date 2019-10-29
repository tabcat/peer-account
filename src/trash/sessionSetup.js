
'use strict'
const Service = require('./service')
const EventEmitter = require('events').EventEmitter
const Handshake = require('./handshake')
const crypto = require('./crypto')

class SetupSession extends Service {
  constructor (orbitdbC, db, capability) {
    super(db, capability)
    this._orbitdbC = orbitdbC
    this.direction = db.options.meta.owner.id === capability.id
      ? 'recipient' : 'sender'
    this.events = new EventEmitter()
    this.sessionTypes = this._state.options.meta.offer.sessionTypes
    this.start()
  }

  // serive type
  static get type () { return 'setup-session' }

  /* persistence methods */

  toJSON () {
    return {
      address: this._state.address.toString(),
      capability: this._capability
    }
  }

  static async _genCapability (idKey, options) {
    await this._identity(options.idKey || idKey)
    const { key, jwk } = await crypto.ecdh.generate(options.curve || 'P-256')
    return { idKey, key: [...key], jwk, curve: options.curve || 'P-256' }
  }

  /* factory methods */

  static async open (orbitdbC, address, capability, options) {
    const db = await orbitdbC.openDb({ address, options })
    await this._verifySetupSession(db)
    await db.load()
    return new SetupSession(orbitdbC, db, capability)
  }

  static async create (orbitdbC, name, options) {
    const capability = await this._genCapability(name, options)
    const identity = await this._identity(capability.idKey)
    const dbAddr = await orbitdbC.dbAddr({
      name,
      type: 'docstore',
      options: {
        identity,
        accessController: { write: ['*'] },
        meta: {
          owner: { key: [...identity.key], id: identity.id },
          offer: {
            lifetime: options.lifetime || 604800000, // one week in ms
            sessionTypes: options.sessionTypes || []
          }
        }
      }
    })
    return this.open(orbitdbC, dbAddr.toString(), capability, options)
  }

  static async requestSetup (orbitdbC, idKey, address, options) {}

  static async join (orbitdbC, idKey, address, options) {
    const capability = await this._genCapability(idKey)
    return this.open(orbitdbC, address, capability, options)
  }

  // this just checks meta field in manifest for now
  static async _verifySetupSession (db) {
    const { owner, offer } = db.options.meta
    if (!owner || !owner.id || !owner.key) {
      throw new Error('invalid setup session')
    }
    if (!offer || !offer.lifetime || !offer.sessionTypes) {
      throw new Error('invalid setup session')
    }
  }

  /* state methods */

  /*
    contact request:
    <request id>: {
      type: type.CONTACT_REQUEST,
      ttl: <expiration timestamp>,
      handshake: <handshake.request>
    }
  */

  async sendOffer (sessionType, name, options) {
    if (!this.sessionTypes.includes(sessionType)) {
      throw new Error('sessionType not supported')
    }
    if (this.direction === 'recipeint') {
      throw new Error('sendRequest called as owner')
    }
    if (this.direction === 'sender' && (await this.state()).length > 0) {
      throw new Error('sendRequest called more than once')
    }
    const iv = await crypto.randomBytes(12)
    if (options.meta) {
      options.meta = {
        key: this._capability.key,
        message: await this._encrypt(options.meta, iv)
      }
    }
    const handshake = await Handshake.offer(
      this._orbitdbC,
      name,
      this._state.options.meta.owner.id,
      options
    )
    const offer = {
      [this._state.options.indexBy]: iv.join(''),
      type: sessionType,
      timestamp: Date.now(),
      handshake: handshake.offer
    }
    await this._state.put(offer)
    this.events.emit('sendRequest', iv.join(''))
    return { offer, handshake }
  }

  async acceptOffer (offerId, options) {
    if (this.direction === 'sender') {
      throw new Error('acceptRequest called as sender')
    }
    const offer = await this._state.get(offerId)[0]
    if (!offer || !await this._validRequest()) {
      throw new Error('invalid request')
    }
    const handshake = await Handshake.accept(
      this._orbitdbC,

    )
    return { offer, handshake }
  }

  async declineRequest (requestId) {
    if (this.direction === 'sender') {
      return this.events.emit('error', 'declineRequest called as sender')
    }
  }

  _validRequest (now, validator = () => true) {
    return (op) => {
      const doc = op.payload.value
      return doc.type === sessionType.CONTACT_REQUEST &&
      doc.timestamp < now &&
      // timestamp has not reached expire date
      doc.timestamp + this._state.options.meta.offer.lifetime > now &&
      validator(op)
    }
  }

  async state () {
    const requests = await this._state.query(
      this._validRequest(
        Date.now(),
        (op) => this.direction === 'recipeint' || op.id === this._capability.id
      ),
      { fullOp: true }
    )
    return Promise.all(requests.map(async (op) => {
      const { meta } = op.payload.value.handshake
      meta.message = await this._decrypt(
        meta.message.cipherbytes,
        meta.message.iv
      )
      return op.payload.value
    }))
  }

  /* encryption methods */

  async _aesKey (requestId) {
    if (this._aes) return this._aes
    const request = await
    this._state.query(doc => doc[this._state.options.indexBy] === requestId)[0]
    const ecdh = await crypto.ecdh.import(this._capability.curve, this._capability.jwk)
    const secret = await ecdh.genSharedKey(Buffer.from(
      this.direction === 'recipient'
        ? this._state.options.meta.owner.key
        : request.meta.key
    ))
    const sa = [...secret]
    const aes = await crypto.aes.deriveKey(
      Buffer.from(sa.slice(0, -12)), // bytes
      Buffer.from(sa.slice(-12)), // salt
      // gets aes length from secret/ecdh length
      sa.length === '256' ? '128' : '256',
      'peer-account-handshake' // purpose
    )
    this._aes = aes
    return aes
  }

  async _encrypt (json, iv) {
    try {
      const aes = await this._aesKey(iv.join(''))
      return await aes.encrypt(Buffer.from(JSON.stringify(json)), Buffer.from(iv))
    } catch (e) {
      this.events.emit('error', e)
    }
  }

  async _decrypt (array, iv) {
    try {
      const aes = await this._aesKey(iv)
      return JSON.parse(await aes.decrypt(Buffer.from(array), Buffer.from(iv)))
    } catch (e) {
      this.events.emit('error', e)
    }
  }
}

module.exports = SetupSession
