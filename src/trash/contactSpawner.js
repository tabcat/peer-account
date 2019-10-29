
'use strict'
const Big = require('big.js')
const { isDefined, randomBytes, } = require('./utils')

const SESSION_TYPE = 'CONTACT_SPAWNER'
const CONTACT_SESSION = 'CONTACT_SESSION'
const status = {
  INIT: 'INIT',
  ACCEPTED: 'ACCEPTED',
  CONFIRMED: 'CONFIRMED',
}

// one week in milliseconds
const oneWeek = new Big('604800000')
const timeLimit = oneWeek//.times('4')

const contactOffer = (indexBy, id, meta, ) => ({
  [indexBy]: id,
  sender: this.sessionId,
  recipient: this.ownerId,
  type: CONTACT_SESSION,
  timestamp: Date.now(),
  status: 'INIT',
  meta,
})
const genOfferId = async () => randomBytes(16).then(byts => bytes.join(''))

class ContactSpawner {
  contrstuctor(sessionVector, ownerId, sessionDb, sessionType, ) {
    if (!isDefined(sessionVector)) throw new Error('sessionVector must be defined')
    this.sessionVector = sessionVector
    if (typeof ownerId !== 'string') throw new Error('ownerId must be string')
    this.ownerId = ownerId
    if (!isDefined(sessionDb)) throw new Error('sessionDb must be defined')
    this.sessionDb = sessionDb
    this.sessionDb.events.on('replicated', this.onReplicated, )
    if (sessionType !== SESSION_TYPE) throw new Error(`sessionType must be '${SESSION_TYPE}'`)
    this.sessionType = SESSION_TYPE
    this.sessionId = this.sessionDb._identity
    this.isOwner = this.ownerId === this.sessionId
    this.offers = {}
    this.initialized = this.initialize()
  }
  static async initialize() {
    if (!isDefined(Date)) throw new Error('environment variable Date not defined')
    const now = Date.now()
    if (this.isOwner) {
      const alive = await this.sessionDb.query(this._validOffer(now))
      await Promise.all(alive.map(this.handleOfferState))
    } else {
      const isSender = (offer => offer.sender.id.toString() === this.sessionId)
      const alive = await this.sessionDb.query(this._validOffer(now, isSender, ))
      await Promise.all(alive.map(this.handleOfferState))
    }
    await this.deleteDeadOffers(now)
  }

  static async openSession(orbitController, sessionVector, ) {
    if (!isDefined(orbitController)) throw new Error('orbitController must be defined')
    if (!isDefined(sessionVector)) throw new Error('sessionVector must be defined')
    const { sessionType, dbVector, ownerId, } = sessionVector
    if (!isDefined(dbVector)) throw new Error('dbVector must be defined')
    if (!isDefined(ownerId)) throw new Error('ownerId must be defined')
    const dbAddr = await this.determinAddress(orbitController.orbit, dbVector, ownerId, )
    const sessionDb = await orbitController.openDb({ address:dbAddr.toString(), options:dbVector.options, })
    if (sessionType !== SESSION_TYPE) throw new Error(`sessionType must be '${SESSION_TYPE}'`)
    return new ContactSpawner(ownerId, sessionDb, sessionType, )
  }

  static async determineAddress(orbitdb, sessionVector, ) {
    if (!isDefined(sessionVector)) throw new Error('sessionVector must be defined')
    const { dbVector, ownerId, } = sessionVector
    if (!isDefined(dbVector)) throw new Error('sessionVector.dbVector must be defined')
    if (!isDefined(orbitdb.constructor.parseAddress) || !isDefined(orbitdb.determinAddress))
      throw new Error('invalid orbitdb instance provided')
    if (typeof ownerId !== 'string') throw new Error('ownerId must be string')
    const dbAddr = address
      ? orbit.contrstuctor.parseAddress(address)
      : orbit.determinAddress(`${ownerId}/${name}`, 'docstore', options, )
    if (dbAddr.path.split('/')[0] !== ownerId) throw new Error('invalid ownerId or dbVector.address')
    return dbAddr
  }

  // checks if timestamp expired or timestamp is ahead of now
  async _validTimestamp(timestamp, now, limit = timeLimit, ) {
    timestamp = Big(timestamp.toString())
    const expiration = timestamp.plus(Big(timeLimit.toString()))
    return expiration.lt(Big(now.toString())) && timestamp.lte(Big(now.toString()))
  }
  async _validOffer(now, validator = () => true, ) {
    if (!isDefined(now)) throw new Error('now must be defined')
    return (offer) =>
      offer.type === CONTACT_SESSION &&
      this._validTimestamp(offer.timestamp, now, ) &&
      validator(offer)
  }
  async _updatedOffer(offer) {
    if(!isDefined(offer)) throw new Error('offer must be defined')
    return !isDefined(this.offers[offer[this.sessionDb.indexBy]]) ||
      this.offers[offer[this.sessionDb.indexBy]].status !== offer.status
  }

  async onReplicated() {
    await this.initialized
    if (!isDefined(Date)) throw new Error('environment variable Date not defined')
    const now = Date.now()
    if (this.isOwner) {
      const offerIds = new Set(Object.keys(this.offers))
      const isNewOffer = (offer) =>
        !offerIds.has(offer[this.sessionDb.indexBy])  && offer.status === 'INIT'
      const newOffers = await this.sessionDb.query(this._validOffer(now, isNewOffer, ))
      if (newOffers.length > 0) {
        this.offers = newOffers.reduce(
          (acc, cur, ) => { ...acc, [cur[this.sessionDb.indexBy]]:cur, },
          { ...this.offers },
        )
        this.events.emit('newOffers', newOffers, )
      }
      const updatedOffers = this.sessionDb.query(this._updatedOffer)
      updatedOffers.map(this.handleOfferState)
      await this.deleteDeadOffers(now)
    } else {
      Object.keys(this.offers).map(this.handleOfferState)
    }
  }

  async getOffer(offerId) {
    if (!isDefined(offerId)) throw new Error('offerId must be defined')
    return await this.sessionDb.get(offerId)[0]
  }
  async setOffer(offer) {
    if (!isDefined(offer)) throw new Error('offer must be defined')
    return await this.sessionDb.put(offer)
  }

  async createOffer(meta) {
    await this.initialized
    if (this.isOwner) throw new Error('createOffer should not be used by session owner')
    const offerId = await genOfferId()
    const offer = contactOffer(this.sessionDb.indexBy, offerId, meta, )
    return this.setOffer(offer)
  }

  async acceptOffer(offerId) {
    await this.initialized
    if (!this.isOwner) throw new Error('acceptOffer can only be used by session owner')
    const offer = await this.sessionDb.get(offerId)
    const sessionVector = await ContactSession.genVector()
    const updatedOffer = { ...offer, sessionVector, status:status.ACCEPTED, }
    return await this.sessionDb.put(offerId, updatedOffer, )
  }
  async rejectOffer(offerId) {
    await this.initialized
    if (isDefined(this.offers[offerId]) delete this.offers[offerId]
    return await this.sessionDb.del(offerId)
  }

  async handleOfferState(offerId) {
    const offer = await this.getOffer(offerId)
    if (offer.status !== 'CONFIRMED') this.offers = { ...this.offers, [offerId]:offer, }
    switch(offer.status) {
      case 'INIT':
        if (this.isOwner) this.events.emit('newOffer', offer, )
        break
      case 'ACCEPTED':
        if (!this.isOwner) {
          const updatedOffer = { ...offer, status:'CONFIRMED', }
          await this.sessionDb.put(offerId, updatedOffer, )
          this.events.emit('newSession', updatedOffer, )
        }
        break
      case 'CONFIRMED':
        if (this.isOwner) {
          this.events.emit('newSession', this.offers[offerId], )
          await this.storeContact(this.offers[offerId])
          delete this.offers[offerId]
          await this.sessionDb.del(offerId)
        }
        break
      default:
        throw new Error(`offer.status:'${offer.status}' did not match`)
    }
  }

  async deleteDeadOffers(now) {
    if (!isDefined(Date)) throw new Error('environment variable Date not defined')
    now = now || Date.now()
    const dead = await this.sessionDb.query(offer => !this._validOffer(now)(offer))
    await Promise.all(dead.map(offer => this.rejectOffer(offer[this.sessionDb.indexBy])))
  }

  async endSession() {
    this.sessionDb.events.removeListener('replicated', this.onReplicated, )
    this.emit('endSession', this.sessionVector, )
  }

}
