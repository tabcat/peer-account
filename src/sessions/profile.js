
'use strict'
const Session = require('../session')
const SessionName = require('../sessionName')

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

      if (this.offer.name && this.offer.address) {
        setStatus(this, status.FROM_ADDRESS)
        const idKey = this.options.idKey || this.offer.name
        const identityProvider = this.options.identityProvider ||
          this._orbitdbC._orbitdb.identity._provider
        this._state = await this._orbitdbC.openDb({
          address: this.offer.address,
          identity: await this.constructor._identity(
            idKey,
            identityProvider
          )
        })
        this._offer = { ...this._offer, meta: this._state.options.meta }
        this._capability = await this.constructor.createCapability({
          idKey,
          identityProvider
        })
      } else {
        setStatus(this, status.FROM_OFFER)
        this._state = await this._orbitdbC.openDb({
          name: this.offer.name,
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
      this.log.error(e)
      this.log.error('failed to initialize profile')
      setStatus(this, status.FAILED)
    }
  }

  static get type () { return 'profile' }

  static async createOffer (capability, options = {}) {
    return {
      name: capability.name,
      meta: {
        sessionType: this.type,
        owner: { id: options.id || capability.id }
      }
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name || !SessionName.isValid(offer.name)) return false
    if (SessionName.parse(offer.name).type !== this.type) return false
    if (!offer.meta) return false
    return true
  }

  static async createCapability (options = {}) {
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    const fromOffer = options.offer && await this.verifyOffer(options.offer)

    if (options.name && !SessionName.isValid(options.name)) {
      throw new Error('invalid session name provided in options.name')
    }

    const name = fromOffer
      ? options.offer.name
      : options.name || SessionName.generate(this.type).toString()

    const idKey = options.idKey || name
    const identity = await this._identity(idKey, options.identityProvider)

    return { name, idKey, id: identity.id }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.name || !SessionName.isValid(capability.name)) return false
    if (SessionName.parse(capability.name).type !== this.type) return false
    if (!capability.idKey || !capability.id) return false
    return true
  }

  static async fromAddress (orbitdbC, address, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!address) throw new Error('address must be defined')
    if (!orbitdbC.isValidAddress(address)) throw new Error('invalid address')
    if (
      !SessionName.isValid(orbitdbC.parseAddress(address).path)
    ) throw new Error('invalid sessionName')

    const sessionName = SessionName.parse(orbitdbC.parseAddress(address).path)
    if (sessionName.type !== this.type) {
      throw new Error(
        `offer type was ${sessionName.type}, expected ${this.type}`
      )
    }

    const offer = { name: sessionName.name, address: address.toString() }
    return new Profile(orbitdbC, offer, null, options)
  }

  get address () { return this._state.address }

  async setProfile (profile) {
    if (!this.isOwner) throw new Error('called setName on unowned profile')
    await this._state.add(profile)
  }

  async getProfile () {
    const entry = this._state.iterator().collect().map(e => e.payload.value)[0]
    return entry || { name: SessionName.parse(this.offer.name).id }
  }

  async getField (field) {
    return this.getProfile().then(profile => profile[field])
  }
}

module.exports = Profile
