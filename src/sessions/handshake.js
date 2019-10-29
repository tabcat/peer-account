
'use strict'
const Session = require('./session')
const EventEmitter = require('events').EventEmitter
const Buffer = require('safe-buffer').Buffer
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  ACCEPTED: 'ACCEPTED',
  // DECLINED: 'DECLINED',
  CONFIRMED: 'CONFIRMED'
}

class Handshake extends Session {
  constructor (db, offer, capability, options = {}) {
    super(db, offer, capability)
    this.direction = offer.recipient === capability.id ? 'recipient' : 'sender'
    this.events = new EventEmitter()
    this._pollState = this._pollState.bind(this)
    this._listening = false
    this.initialized = this._initialize()
    if (options.start) this.start()
  }

  async _initialize () {
    try {
      this._state = await this._state
    } catch (e) {
      console.error(e)
    }
  }

  // session type
  static get type () { return 'handshake' }

  /* persistence methods */

  static async _createOffer (offerName, options = {}) {
    if (!options.sender || !options.recipient || !options.curve) {
      throw new Error('missing required option fields to create offer')
    }
    return {
      type: this.type,
      name: offerName,
      sender: options.sender,
      recipient: options.recipient,
      meta: { sessionType: this.type, curve: options.curve }
    }
  }

  static async verifyOffer (orbitdbC, offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.type || !offer.name) return false
    if (offer.type !== this.type) return false
    if (!offer.sender || !offer.recipient || !offer.meta) return false
    if (!offer.meta.sessionType || !offer.meta.curve) return false
    return true
  }

  static async _genCapability (offerName, options = {}) {
    const idKey = options.idKey || offerName
    const identity = await this._identity(idKey)
    const curve = options.curve || 'P-256'
    const { key, jwk } = await crypto.ecdh.generate(curve)
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
        identity: await this._identity(capability.idKey),
        meta: offer.meta,
        accessController: { write: [offer.sender, offer.recipient] }
      }
    })
    return new Handshake(db, offer, capability, options)
  }

  static async offer (orbitdbC, options = {}) {
    if (!options.recipient) throw new Error('options.recipeint is required')
    const { name } = await this._genOfferName()
    const capability = await this._genCapability(name, options)
    const offer = await this._createOffer(
      name,
      {
        sender: capability.id,
        recipient: options.recipient,
        curve: capability.curve
      }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  static async accept (orbitdbC, offer, options = {}) {
    const capability = await this._genCapability(
      offer.name,
      { idKey: options.idKey, curve: options.curve }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  // static async decline (orbitdbC, offer, options) {
  //   const capability = await this._genCapability(offer, options)
  //   const handshake = await this.open(orbitdbC, offer, capability, options)
  //   return handshake._state.put({
  //     [handshake._state.options.indexBy]: 'state',
  //     status: status.DECLINED
  //   })
  // }

  /* state methods */

  async start () {
    await this.initialized
    if (this._listening) { return }
    this._listening = true
    this._state.events.on('replicated', this._pollState)
    this._pollState()
  }

  /*
    final state
    {
      status: 'CONFIRMED',
      // id's are encrypted in this._state docstore
      // id's are returned decrypted in this.state if status is complete
      // aes does not exist in this._state docstore
      // aes is returned by this.state only when complete
      sender: { id, key },
      recipient: { id, key },
      aes: [<raw aes key>] // not stored in docstore
    }
  */

  async state () {
    try {
      await this.initialized
      const state = await this._state.query(
        doc => doc[this._state.options.indexBy] === 'state'
      )[0]
      // sender has not initialized state
      if (!state) return { status: status.PRE_INIT }
      // return state with decrypted identity fields when status is confirmed
      if (state.status === status.CONFIRMED) {
        const remote = this.direction === 'recipient' ? 'sender' : 'recipient'
        return {
          ...state,
          [remote]: {
            ...state[remote],
            id: await this._decrypt(
              state[remote].id,
              `${remote}-${this.offer.name}`,
              state
            )
          },
          [this.direction]: {
            ...state[this.direction],
            id: await this._decrypt(
              state[this.direction].id,
              `${this.direction}-${this.offer.name}`,
              state
            )
          },
          aes: [...Buffer.from(
            await crypto.aes.exportKey(await this._aesKey(state))
          )]
        }
      }
      return state
    } catch (e) {
      console.error(e)
    }
  }

  async _pollState () {
    try {
      await this.initialized
      if (!this._listening) {
        return this.events.emit(
          'error',
          new Error('polled state while not listening')
        )
      }
      const state = await this.state()
      console.log({ state, polled: true })
      switch (state.status) {
        case status.PRE_INIT:
          if (this.direction === 'sender') {
            await this._state.put({
              [this._state.options.indexBy]: 'state',
              status: status.INIT,
              sender: { key: [...this._capability.key] }
            })
          }
          return
        case status.INIT:
          if (!state.sender || !state.sender.key) {
            this.events.emit(
              'error',
              new Error(`invalid ${status.INIT} state: ${state}`)
            )
          }
          if (this.direction === 'recipient') {
            await this._state.put({
              [this._state.options.indexBy]: 'state',
              ...state,
              status: status.ACCEPTED,
              recipient: {
                id: [...(await this._encrypt(
                  (await Handshake._identity(this.offer.name)).id,
                  `${this.direction}-${this.offer.name}`,
                  state
                )).cipherbytes],
                key: [...this._capability.key]
              }
            })
          }
          return
        case status.ACCEPTED:
          if (!state.recipient || !state.recipient.id || !state.recipient.key) {
            this.events.emit(
              'error',
              new Error(`invalid ${status.ACCEPTED} state: ${state}`)
            )
          }
          if (this.direction === 'sender') {
            await this._state.put({
              [this._state.options.indexBy]: 'state',
              ...state,
              status: status.CONFIRMED,
              sender: {
                ...state.sender,
                id: [...(await this._encrypt(
                  (await Handshake._identity(this.offer.name)).id,
                  `${this.direction}-${this.offer.name}`,
                  state
                )).cipherbytes]
              }
            })
          }
          this._pollState()
          return
        // case status.DECLINED:
        //   this._state.events.removeListener('write', this._pollState)
        //   this._state.events.removeListener('replicated', this._pollState)
        //   this._listening = false
        //   this.events.emit('declined')
        //   return
        case status.CONFIRMED:
          this._state.events.removeListener('replicated', this._pollState)
          this._listening = false
          this.events.emit('confirmed')
          return
        default:
          throw new Error('default case matched')
      }
    } catch (e) {
      console.error(e)
    }
  }

  /* encryption methods */

  async _aesKey (state) {
    if (this._aes) return this._aes
    if (
      state.status === status.PRE_INIT ||
      (state.status === status.INIT && this.direction === 'sender')
    ) {
      return this.events.emit(
        'error',
        new Error('_aesKey called on PRE_INIT state')
      )
    }
    const ecdh = await crypto.ecdh.import(
      this._capability.curve,
      this._capability.jwk
    )
    const secret = await ecdh.genSharedKey(Buffer.from(
      state[this.direction === 'recipient' ? 'sender' : 'recipient'].key
    ))
    const sa = [...secret]
    const aes = await crypto.aes.deriveKey(
      Buffer.from(sa.slice(0, -12)), // bytes
      Buffer.from(sa.slice(-12)), // salt
      sa.length === '256' ? '128' : '256', // aes length from secret/ecdh length
      Handshake.type // purpose
    )
    this._aes = aes
    return aes
  }

  async _encrypt (json, iv, state) {
    try {
      const key = await this._aesKey(state)
      return await key.encrypt(
        Buffer.from(JSON.stringify(json)),
        Buffer.from(iv)
      )
    } catch (e) {
      this.events.emit('error', e)
    }
  }

  async _decrypt (array, iv, state) {
    try {
      const key = await this._aesKey(state)
      return JSON.parse(new TextDecoder().decode(
        await key.decrypt(Buffer.from(array), Buffer.from(iv))
      ))
    } catch (e) {
      this.events.emit('error', e)
    }
  }
}

module.exports = Handshake
