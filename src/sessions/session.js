
'use strict'
const Identities = require('orbit-db-identity-provider')
const EventEmitter = require('events').EventEmitter
const Logger = require('logplease')

const statuses = {
  PRE_INIT: 'PRE_INIT'
}
const setStatus = (self) => {
  if (!self.events) throw new Error('no events property')
  return function (status = '') {
    status = status.toString()
    if (self.status === status) {
      self.log.warn(`status already is already set to '${status}'`)
    } else {
      self.status = status
      self.events.emit('status', status)
      self.events.emit(`status:${status}`)
    }
  }
}

class Session {
  constructor (p2p, offer, capability, options = {}) {
    if (!p2p) throw new Error('p2p must be defined')
    if (!offer || !offer.sessionId) {
      throw new Error('offer.sessionId must be defined')
    }

    // orbitdbController for opening session state
    this._orbitdbC = p2p._orbitdbC || p2p

    // the unique id of the session
    this._sessionId = offer.sessionId.toString()

    // offer contains data for all participants
    this._offer = offer

    // contains private data like encryption keys
    this._capability = capability

    // state is derived in this._initialize from offer and capability
    this._state = null

    this.options = options
    this.events = new EventEmitter()
    this.setStatus = setStatus(this)
    this.log = Logger.create(this.sessionId)

    this.setStatus(statuses.PRE_INIT)
    this.events.on('status', status => this.log.debug(`status set to ${status}`))
    this.log.debug('instance created')

    // set to this._initialize() in sub class
    this.initialized = null
  }

  static get type () { return 'session' }

  async _initialize () {}

  get sessionId () { return this._sessionId }

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
