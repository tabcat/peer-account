
'use strict'
const Session = require('./session')
const OfferName = require('./offerName')
const EventEmitter = require('events').EventEmitter
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  PRE_CREATION: 'PRE_CREATION',
  CREATED: 'CREATED',
  ACCEPTED: 'ACCEPTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED'
}
const setStatus = require('./utils').setStatus(status)
const setLogOutputs = require('./utils').setLogOutput

/*
  the goal of Handshake is to securely:
    1. derive a shared aes key
    2. communicate new orbitdb identity ids
*/

class Handshake extends Session {
  constructor (db, offer, capability, options = {}) {
    super(db, offer, capability)
    if (!options.identityProvider) {
      throw new Error('options.identityProvider required')
    }
    this._identityProvider = options.identityProvider
    this.direction = offer.recipient === capability.id ? 'recipient' : 'sender'
    this._listening = false
    this._pollState = this._pollState.bind(this)
    this.events = new EventEmitter()
    this.initialized = this._initialize()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, Handshake.type, options.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      this._state = await this._state
      setStatus(this, await this.state().then(s => s.status))
      if (this.options.start) this.start()
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
    }
  }

  // session type
  static get type () { return 'handshake' }

  /* persistence methods */

  static async _createOffer (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (!options.sender || !options.recipient || !options.curve) {
      throw new Error('missing required option fields to create offer')
    }

    return {
      name: offerName.name,
      sender: options.sender,
      recipient: options.recipient,
      meta: { sessionType: this.type, curve: options.curve }
    }
  }

  static async verifyOffer (orbitdbC, offer) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name) return false
    if (OfferName.parse(offer.name).type !== this.type) return false
    if (!offer.sender || !offer.recipient || !offer.meta) return false
    if (!offer.meta.sessionType || !offer.meta.curve) return false
    if (!offer.meta.sessionType !== this.type) return false
    return true
  }

  static async _genCapability (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    const idKey = options.idKey || offerName.name
    const identity = await this._identity(idKey, options.identityProvider)
    const curve = options.curve || 'P-256'
    const { key, jwk } = await crypto.ecdh.generate(curve)
    return { idKey, id: identity.id, key: [...key], jwk, curve }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (
      !capability.idKey || !capability.id || !capability.key ||
      !capability.jwk || !capability.curve
    ) return false
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
    return new Handshake(
      db,
      offer,
      capability,
      {
        log: options.log,
        identityProvider: orbitdbC._orbitdb.identity._provider
      }
    )
  }

  static async offer (orbitdbC, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!options.recipient) throw new Error('options.recipeint is required')
    const offerName = OfferName.generate(this.type)
    const capability = await this._genCapability(
      offerName,
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey,
        curve: options.curve
      }
    )
    const offer = await this._createOffer(
      offerName,
      {
        sender: capability.id,
        recipient: options.recipient,
        curve: capability.curve
      }
    )
    return this.open(
      orbitdbC,
      offer,
      capability,
      {
        log: options.log,
        identityProvider: orbitdbC._orbitdb.identity._provider
      }
    )
  }

  static async accept (orbitdbC, offer, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    const capability = await this._genCapability(
      offer.name,
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey,
        curve: offer.meta.curve
      }
    )
    return this.open(
      orbitdbC,
      offer,
      capability,
      {
        log: options.log,
        identityProvider: orbitdbC._orbitdb.identity._provider
      }
    )
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
    await this._pollState()
  }

  /*
    final state:
    {
      status: 'CONFIRMED',
      // id's are encrypted in this._state docstore
      // id's are returned decrypted in this.state if status is complete
      // aes does not exist in this._state docstore
      // aes is returned by this.state only when complete
      sender: { id, key, idKey },
      recipient: { id, key, idKey },
      aes: [<raw aes key>] // calculated from completed state
    }
  */

  async state () {
    await this.initialized
    const state = await this._state.query(
      doc => doc[this._state.options.indexBy] === 'state'
    )[0]
    // sender has not initialized state
    if (!state) return { status: status.PRE_CREATION }
    if (!state.status) {
      throw new Error('state did not contain a status field')
    }
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
        aes: [...await crypto.aes.exportKey(await this._aesKey(state))],
        idKey: `newIdKey-${this.offer.name}`
      }
    } else return state
  }

  async _pollState () {
    try {
      await this.initialized
      if (!this._listening) this.log.error('polled state while not listening')
      const state = await this.state()
      if (!status[state.status]) {
        throw new Error(`invalid state status: ${state.status}`)
      }
      setStatus(this, status[state.status])
      switch (state.status) {
        case status.PRE_CREATION:
          if (this.direction === 'sender') {
            await this._state.put({
              [this._state.options.indexBy]: 'state',
              status: status.CREATED,
              sender: { key: [...this.capability.key] }
            })
            setStatus(this, status.CREATED)
          }
          return
        case status.CREATED:
          if (!state.sender || !state.sender.key) {
            throw new Error(`invalid ${status.CREATED} state: ${state}`)
          }
          if (this.direction === 'recipient') {
            const identity = await Handshake._identity(
              this.newIdKey,
              this._identityProvider
            )
            const encryptedId = await this._encrypt(
              identity.id,
              `${this.direction}-${this.offer.name}`,
              state
            )
            await this._state.put({
              ...state,
              status: status.ACCEPTED,
              recipient: {
                id: [...encryptedId.cipherbytes],
                key: [...this.capability.key]
              }
            })
            setStatus(this, status.ACCEPTED)
          }
          return
        case status.ACCEPTED:
          if (
            !state.recipient || !state.recipient.id || !state.recipient.key
          ) throw new Error(`invalid ${status.ACCEPTED} state: ${state}`)
          if (this.direction === 'sender') {
            const identity = await Handshake._identity(
              this.newIdKey,
              this._identityProvider
            )
            const encryptedId = await this._encrypt(
              identity.id,
              `${this.direction}-${this.offer.name}`,
              state
            )
            await this._state.put({
              ...state,
              status: status.CONFIRMED,
              sender: {
                ...state.sender,
                id: [...encryptedId.cipherbytes]
              }
            })
            setStatus(this, status.CONFIRMED)
            this._pollState()
          }
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
          return
        default:
          throw new Error(`no case for status: ${state.status}`)
      }
    } catch (e) {
      this.log.error(e)
    }
  }

  /* encryption methods */

  async _aesKey (state) {
    if (this._aes) return this._aes
    if (
      this.status === status.PRE_INIT ||
      (this.status === status.INIT && this.direction === 'sender')
    ) throw new Error('_aesKey called before state was prepared')
    const ecdh = await crypto.ecdh.import(this.capability.jwk)
    const secret = await ecdh.genSharedKey(new Uint8Array(
      state[this.direction === 'recipient' ? 'sender' : 'recipient'].key
    ))
    const aes = await crypto.aes.deriveKey(
      secret.slice(0, -12), // bytes
      secret.slice(-12), // salt
      128 // key length
    )
    this._aes = aes
    return aes
  }

  async _encrypt (json, iv, state) {
    try {
      const key = await this._aesKey(state)
      return await key.encrypt(
        crypto.util.str2ab(JSON.stringify(json)),
        new Uint8Array(iv)
      )
    } catch (e) {
      this.log.error(e)
    }
  }

  async _decrypt (cipherbytes, iv, state) {
    try {
      const key = await this._aesKey(state)
      const decrypted = await key.decrypt(
        new Uint8Array(cipherbytes),
        new Uint8Array(iv)
      )
      return JSON.parse(crypto.utils.ab2str(decrypted.buffer))
    } catch (e) {
      this.log.error(e)
    }
  }
}

module.exports = Handshake
