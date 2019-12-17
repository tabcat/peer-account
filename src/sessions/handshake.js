
'use strict'
const Session = require('../session')
const SessionName = require('../sessionName')
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
const setStatus = require('../utils').setStatus(status)

const idKey = (sessionName) => `idKey-${sessionName}`

/*
  the goal of Handshake is to securely:
    1. derive a shared aes key
    2. communicate new orbitdb identity ids
*/

class Handshake extends Session {
  constructor (orbitdbC, offer, capability, options = {}) {
    super(orbitdbC, offer, capability, options)
    this._identityProvider = options.identityProvider ||
      this._orbitdbC._orbitdb.identity._provider
    this.direction = offer.recipient === capability.id ? 'recipient' : 'sender'
    this._listening = false
    this._pollState = this._pollState.bind(this)
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
            this._identityProvider
          ),
          accessController: {
            write: [this.offer.sender, this.offer.recipient]
          },
          meta: this.offer.meta
        }
      })
      setStatus(this, await this.state().then(s => s.status))
      if (this.options.start) this.start()
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
    }
  }

  static get type () { return 'handshake' }

  static async createOffer (capability, options = {}) {
    if (!await this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }
    if (!options.recipient) {
      throw new Error('options.recipient must be defined')
    }

    return {
      name: capability.name,
      sender: options.sender || capability.id,
      recipient: options.recipient,
      meta: { sessionType: this.type, curve: capability.curve }
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name || !SessionName.isValid(offer.name)) return false
    if (SessionName.parse(offer.name).type !== this.type) return false
    if (!offer.sender || !offer.recipient || !offer.meta) return false
    if (!offer.meta.sessionType || !offer.meta.curve) return false
    if (offer.meta.sessionType !== this.type) return false
    return true
  }

  static async createCapability (options = {}) {
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    const fromOffer = options.offer && await this.verifyOffer(options.offer)

    const name = fromOffer
      ? options.offer.name
      : options.name || SessionName.generate(this.type).toString()
    const curve = fromOffer
      ? options.offer.meta.curve
      : options.curve || 'P-256'

    const idKey = options.idKey || name
    const identity = await this._identity(idKey, options.identityProvider)
    const { key, jwk } = await crypto.ecdh.generateKey(curve)

    return { name, idKey, id: identity.id, key: [...key], jwk, curve }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.name || !SessionName.isValid(capability.name)) return false
    if (SessionName.parse(capability.name).type !== this.type) return false
    if (
      !capability.idKey || !capability.id || !capability.key ||
      !capability.jwk || !capability.curve
    ) return false
    return true
  }

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
      sender: { id, key, idKey },
      recipient: { id, key, idKey },
      aes: <raw aes key> // calculated from completed state, its a json array
    }

    id's are encrypted in this._state docstore
    id's are returned decrypted in this.state if status is complete
    aes does not exist in this._state docstore
    aes is returned by this.state only when complete
  */

  async state () {
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
        idKey: idKey(this.offer.name)
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
              idKey(this.offer.name),
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
              idKey(this.offer.name),
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
          setStatus(this, status.CONFIRMED)
          return
        default:
          throw new Error(`no case for status: ${state.status}`)
      }
    } catch (e) {
      this.log.error(e)
    }
  }

  async _aesKey (state) {
    if (this._aes) return this._aes
    if (
      state.status === status.PRE_INIT ||
      (state.status === status.INIT && this.direction === 'sender')
    ) throw new Error('_aesKey called before state was prepared')
    const ecdh = await crypto.ecdh.importKey(this.capability.jwk)
    const secret = await ecdh.genSharedKey(new Uint8Array(
      state[this.direction === 'recipient' ? 'sender' : 'recipient'].key
    ))
    const aes = await crypto.aes.deriveKey(
      secret.slice(0, -12), // bytes
      secret.slice(-12), // salt
      128 // key length
    )
    this._aes = aes
    return this._aes
  }

  async _encrypt (json, iv, state) {
    try {
      const key = await this._aesKey(state)
      return key.encrypt(
        crypto.util.str2ab(JSON.stringify(json)),
        SessionName.parse(this.offer.name).iv
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
        SessionName.parse(this.offer.name).iv
      )
      return JSON.parse(crypto.util.ab2str(decrypted.buffer))
    } catch (e) {
      this.log.error(e)
    }
  }
}

module.exports = Handshake
