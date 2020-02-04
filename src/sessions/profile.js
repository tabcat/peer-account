
'use strict'
const Session = require('./session')
const SessionId = require('./sessionId')

const status = {
  INIT: 'INIT',
  FROM_ADDRESS: 'FROM_ADDRESS',
  FROM_OFFER: 'FROM_OFFER',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class Profile extends Session {
  constructor (orbitdbC, offer, capability, options = {}) {
    super(orbitdbC, offer, capability, options)
    this.isOwner = null
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)

      if (this.offer.sessionId && this.offer.profile) {
        setStatus(this, status.FROM_ADDRESS)
        const dbAddr = await this._orbitdbC.parseAddress(this.offer.profile)
        if (this.offer.sessionId !== dbAddr.path) {
          throw new Error('sessionId does not match address')
        }
        const idKey = this.options.idKey || this.offer.sessionId
        const identityProvider = this.options.identityProvider ||
          this._orbitdbC._orbitdb.identity._provider
        this._state = await this._orbitdbC.openDb({
          address: this.offer.profile,
          options: {
            identity: await this.constructor._identity(
              idKey,
              identityProvider
            )
          }
        })
        this._offer = { ...this._offer, meta: this._state.options.meta }
        this._capability = await this.constructor.createCapability({
          idKey,
          identityProvider
        })
      } else {
        setStatus(this, status.FROM_OFFER)
        this._state = await this._orbitdbC.openDb({
          name: this.offer.sessionId,
          type: 'eventlog',
          options: {
            identity: await this.constructor._identity(
              this.capability.idKey,
              this._orbitdbC._orbitdb.identity._provider
            ),
            accessController: {
              write: [this.offer.meta.owner.id]
            },
            meta: this.offer.meta
          }
        })
      }

      this.isOwner = this.offer.meta.owner.id === this.capability.id
      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Profile.type} failed initialization`)
    }
  }

  static get type () { return 'profile' }

  async address () {
    await this.initialized
    return this._state.address
  }

  async getName () {
    const name = await this.getField('name')
    return name || this.offer.sessionId
  }

  async setProfile (profile) {
    if (!this.isOwner) throw new Error('called setName on unowned profile')
    await this._state.add(profile)
  }

  async getProfile () {
    const entry = this._state.iterator().collect().map(e => e.payload.value)[0]
    return entry || { name: SessionId.parse(this.offer.sessionId).pos }
  }

  async getField (field) {
    return this.getProfile().then(profile => profile[field])
  }

  async setField (field, value) {
    const profile = await this.getProfile()
    return this.setProfile({ ...profile, [field]: value })
  }

  static async createOffer (capability, options = {}) {
    return {
      sessionId: capability.sessionId.toString(),
      meta: {
        sessionType: this.type,
        owner: { id: options.id || capability.id }
      }
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.sessionId || !SessionId.isValid(offer.sessionId)) return false
    if (SessionId.parse(offer.sessionId).type !== this.type) return false
    if (!offer.meta) return false
    return true
  }

  static async createCapability (options = {}) {
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    if (options.sessionId && !SessionId.isValid(options.sessionId)) {
      throw new Error('invalid sessionId provided in options.sessionId')
    }

    const fromOffer = options.offer && await this.verifyOffer(options.offer)
    const sessionId = fromOffer
      ? options.offer.sessionId
      : options.sessionId || SessionId.generate(this.type).toString()

    const idKey = options.idKey || sessionId
    const identity = await this._identity(idKey, options.identityProvider)

    return { sessionId: sessionId.toString(), idKey, id: identity.id }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.sessionId || !SessionId.isValid(capability.sessionId)) {
      return false
    }
    if (SessionId.parse(capability.sessionId).type !== this.type) return false
    if (!capability.idKey || !capability.id) return false
    return true
  }
}

module.exports = Profile
