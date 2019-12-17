
'use strict'
const Session = require('./session')
const OfferName = require('./offerName')

class Channel extends Session {
  constructor (db, offer, capability, options = {}) {
    super(db, offer, capability, options)
    // array of session 'type' properties supported by the channel
    this._supported = []
  }

  static get type () { return 'channel' }

  get supported () { return this._supported }

  isSupported (type) {
    return this.supported.includes(type) || this.supported.includes('*')
  }

  /*
    offers are never seen as 'accepted' or 'declined' from the view of the
    channel they were sent in.
    instead a sender sees whether an offer they sent was accepted by seeing
    the recipient join the session within a timeout period they set.
  */

  async sendOffer (offer) {}

  async getOffer (offerName) {}

  async getOffers () {}

  _isValidOffer (now, validator = () => true) {
    if (typeof validator !== 'function') {
      throw new Error('given validator was not a function')
    }
    return (op) => {
      const offer = op.payload.value
      return this.isSupported(OfferName.parse(offer.name).type) &&
      offer._channel &&
      (
        offer._channel.name !== undefined
          ? offer._channel.name === this.offer.name
          : false
      ) &&
      (
        offer._channel.address !== undefined
          ? offer._channel.address === this._state.address.toString()
          : false
      ) &&
      // if offer has timestamp field timestamp must be before now and alive
      (
        offer._channel.timestamp !== undefined
          ? offer._channel.timestamp <= now
            ? this.offer.meta && this.offer.meta.lifetime
              ? offer._channel.timestamp + this.offer.meta.lifetime >= now
              : true
            : false
          : false
      ) && validator(op)
    }
  }
}

module.exports = Channel
