
'use strict'
const Identities = require('orbit-db-identity-provider')
const EventEmitter = require('events').EventEmitter

const status = {
  PRE_INIT: 'PRE_INIT'
}
const setStatus = require('../utils').setStatus(status)
const setLogOutputs = require('../utils').setLogOutputs

class Session {
  constructor (p2p, offer, capability, options = {}) {
    if (!p2p) throw new Error('p2p must be defined')
    // orbitdbController for opening session state
    this._orbitdbC = p2p._orbitdbC || p2p
    // state is derived at a later time from offer and capability
    this._state = null
    this._offer = offer // offer contains data for all participants
    this._capability = capability // contains private data like encryption keys
    this.options = options
    this.events = new EventEmitter()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, this.constructor.type, options.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
    this.initialized = null
  }

  static get type () { return 'session' }

  get offer () { return this._offer }

  get capability () { return this._capability }

  // data needed to reopen session later
  toJSON () {
    return {
      offer: this.offer,
      capability: this.capability
    }
  }

  // generate identity for session capability
  static async _identity (id, identityProvider) {
    if (!id) throw new Error('id must be defined to create identity')
    if (!identityProvider) {
      throw new Error('identityProvider must be defined to create identity')
    }
    return Identities.createIdentity({
      id,
      keystore: identityProvider._keystore,
      signingKeystore: identityProvider._signingKeystore
    })
  }

  static open (p2p, offer, capability, options = {}) {
    if (!p2p) throw new Error('p2p must be defined')
    if (!offer) throw new Error('offer must be defined')
    // if (!capability) throw new Error('capability must be defined')
    return new this(p2p, offer, capability, options)
  }

  static async offer (p2p, options = {}) {
    if (!p2p) throw new Error('p2p must be defined')
    const orbitdbC = p2p._orbitdbC || p2p
    const capability = await this.createCapability(
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        ...options
      }
    )
    const offer = await this.createOffer(
      capability,
      options
    )
    return this.open(p2p, offer, capability, { log: options.log })
  }

  static async accept (p2p, offer, options = {}) {
    if (!p2p) throw new Error('p2p must be defined')
    if (!offer) throw new Error('offer must be defined')
    if (!await this.verifyOffer(offer)) throw new Error('invalid offer')
    const orbitdbC = p2p._orbitdbC || p2p
    const capability = options.capability || await this.createCapability(
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        ...options,
        // have capability to use the nondeterministic values from offer
        offer
      }
    )
    return this.open(p2p, offer, capability, { log: options.log })
  }

  static async createOffer (capability, options = {}) { return {} }

  static async verifyOffer (offer) { return true }

  static async createCapability (options = {}) { return {} }

  static async verifyCapability (capability) { return true }

  // static async decline (orbitdbC, offer, options = {}) {}
}

module.exports = Session
