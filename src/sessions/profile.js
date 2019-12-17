
'use strict'
const Session = require('../session')
const OfferName = require('../offerName')

const status = {
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class Profile extends Session {
  constructor (orbitdbC, offer, capability, options = {}) {
    super(orbitdbC, offer, capability, options)
    this.isOwner = null
    this.profile = null
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      this._state = await this._orbitdbC.openDb({
        name: this.offer.name,
        type: 'log',
        options: {
          identity: await this._identity(
            this.capability.idKey,
            this._orbitdbC._orbitdb.identity._provider
          ),
          accessController: {
            write: [this.offer.meta.owner.id]
          },
          meta: this.offer.meta
        }
      })
      this.isOwner = this.offer.meta.owner.id === this.capability.id
      this.profile = await this.getProfile()
      if (this.isOwner && this.profile === undefined) {
        await this.setProfile({ name: OfferName.parse(this.offer.name).id })
      }
      setStatus(this, status.READY)
    } catch (e) {
      this.log.error(e)
      this.log.error('failed to initialize profile')
      setStatus(this, status.FAILED)
    }
  }

  // session type
  static get type () { return 'profile' }

  static async createOffer (offerName, capability, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')

    return {
      name: offerName.name,
      meta: { sessionType: this.type, owner: { id: capability.id } }
    }
  }

  static async verifyOffer (orbitdbC, offer) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name) return false
    if (OfferName.parse(offer.name).type !== this.type) return false
    if (!offer.meta) return false
    return true
  }

  static async createCapability (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')

    const idKey = options.idKey || offerName.name
    const identity = await this._identity(idKey, options.identityProvider)

    return {
      idKey,
      id: identity.id
    }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.idKey || !capability.id) return false
    return true
  }

  // static async decline (orbitdbC, offer, options = {}) {}

  async setProfile (profile) {
    if (!this.isOwner) throw new Error('called setName on not owned profile')
    const entry = await this._state.add(profile)
    this.profile = await this.getProfile()
    return entry
  }

  async getProfile () {
    const event = await this._state.iterator().collect() // useless await so why not
    const entry = event.map(e => e.payload.value)[0]
    return entry === undefined ? entry : undefined
  }
}

module.exports = Profile
