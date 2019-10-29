
/*
  this is a template class
*/

'use strict'
const Session = require('./session')

class Channel extends Session {
  constructor (orbitdbC, db, offer, capability, options = {}) {
    super(db, offer, capability)
    this._orbitdbC = orbitdbC
    this.options = options
    this.direction = 'recipient'
    this._supported = []
  }

  /* state methods */

  get supported () { return this._supported }

  isSupported (type) {
    return this.supported.includes(type)
  }

  async sendOffer (offer) {}

  // async consumeOffer (offerName) {}

  async getOffer (offerName) {}

  async getOffers () {}

  _isValidOffer (now, validator = {}) {
    validator = typeof validator === 'function'
      ? validator
      : (op) =>
        this.direction === 'recipient' ||
        op.identity.id === this._capability.id
    return (op) => {
      const offer = op.payload.value
      return this.isSupported(offer.type) &&
      // if offer has timestamp field timestamp must be before now and alive
      (
        offer.timestamp !== undefined
          ? offer.timestamp <= now
            ? this.offer.meta && this.offer.meta.lifetime
              ? offer.timestamp + this.offer.meta.lifetime >= now
              : true
            : false
          : true
      ) && validator(op)
    }
  }
}

module.exports = Channel
