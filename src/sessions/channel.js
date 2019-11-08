
'use strict'
const Session = require('./session')

class Channel extends Session {
  constructor (db, offer, capability, options = {}) {
    super(db, offer, capability)
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

  _isValidOffer (now, validator = () => true) {
    if (typeof validator !== 'function') {
      throw new Error('given validator was not a function')
    }
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
          : false
      ) && validator(op)
    }
  }
}

module.exports = Channel
