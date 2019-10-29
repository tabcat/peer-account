
'use strict'
const Service = require('./service')
const Contact = require('./contactSession')
const EventEmitter = require('events').EventEmitter
const Handshake = require('./handshake')
const crypto = require('./crypto')

const sessionType = {
  CONTACT_REQUEST: 'CONTACT_REQUEST'
}

class ContactSpawner extends Service {
  constructor (orbitdbC, db, capability) {
    super(db, capability)
    this._orbitdbC = orbitdbC
    this.direction = db.options.meta.owner.id === capability.id
      ? 'recipient' : 'sender'
    this.events = new EventEmitter()
    this.listening = false
    this._pollState = this._pollState.bind(this)
    this.requests = {}
    this.start()
  }

  // serive type
  static get type () { return 'contact-spawner' }

  /* lifetime methods */

  start () {
    if (this.listening) { return }
    this.listening = true
    const t = this
    this._pollState()
      .then(() => {
        t._state.events.on('write', t._pollState)
        t._state.events.on('replicate', t._pollState)
      })
      .catch((e) => t.events.emit('error', e))
  }

  pause () {
    if (!this.listening) { return }
    this.listening = false
    this._state.events.removeListener('write', this._pollState)
    this._state.events.removeListener('replicated', this._pollState)
  }

  stop () {
    if (this.listening) this.pause()
    this._state.close()
  }

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
    await this._verifyContactSpawner(db)
    await db.load()
    return new ContactSpawner(orbitdbC, db, capability)
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
          offer: { lifetime: options.lifetime || 604800000 } // one week in ms
        }
      }
    })
    return this.open(orbitdbC, dbAddr.toString(), capability, options)
  }

  static async join (orbitdbC, idKey, address, options) {
    const capability = await this._genCapability(idKey)
    return this.open(orbitdbC, address, capability, options)
  }

  static async _verifyContactSpawner (db) {
    const { owner, offer } = db.options.meta
    if (!owner || !owner.id || !owner.key) throw new Error('invalid contact spawner')
    if (!offer || !offer.lifetime) throw new Error('invalid contact spawner')
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

  async sendRequest (name, options) {
    if (this.direction === 'recipeint') {
      return this.events.emit('error', 'sendRequest called as owner')
    }
    if (this.direction === 'sender' && (await this.state()).length > 0) {
      return this.events.emit('error', new Error('should only be sending one request'))
    }
    const iv = await crypto.randomBytes(12)
    if (options.meta) {
      options.meta = {
        key: this._capability.key,
        message: await this._encrypt(options.meta, iv)
      }
    }
    const handshake = await Handshake.request(
      this._orbitdbC,
      name,
      this._state.options.meta.owner.id,
      options
    )
    const contactRequest = {
      [this._state.options.indexBy]: iv.join(''),
      type: sessionType.CONTACT_REQUEST,
      timestamp: Date.now(),
      handshake: handshake.request
    }
    await this._state.put(contactRequest)
    this.events.emit('sendRequest', iv.join(''))
    return Contact.fromRequest(this._orbitdbC, contactRequest, handshake, options)
  }

  async acceptRequest (requestId) {
    if (this.direction === 'sender') {
      return this.events.emit('error', 'acceptRequest called as sender')
    }
    const request = await this._state.get(requestId)
    if (!request || !await this._validRequest()) {
      throw new Error('invalid request')
    }
    const handshake = await Handshake.accept(
      this._orbitdbC,

    )
    return Contact.fromRequest(this._orbitdbC, request, handshake, options)
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

  async _pollState () {
    this.requests = await this.state()
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
      sa.length === '256' ? '128' : '256', // gets aes length from secret/ecdh length
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

module.exports = ContactSpawner
