
/*
  this is a template class
*/

'use strict'
const Identities = require('orbit-db-identity-provider')

class Session {
  constructor (state, offer, capability) {
    this._state = state
    this.offer = offer
    this._capability = capability
  }

  // session type
  static get type () { return 'session' }

  /* persistence methods */

  toJSON () {
    return {
      offer: this.offer,
      capability: this._capability
    }
  }

  static async _createOffer (offerName, options = {}) {}

  static async verifyOffer (orbitdbC, offer) {}

  static async _genCapability (offerName, options = {}) {}

  static async verifyCapability (capability) {}

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

  /* factories */

  static async open (orbitdbC, offer, capability, options = {}) {}

  static async offer (orbitdbC, options = {}) {}

  static async accept (orbitdbC, offer, options = {}) {}

  static async decline (orbitdbC, offer, options = {}) {}
}

module.exports = Session
