
'use strict'
const Identities = require('orbit-db-identity-provider')

class Service {
  constructor (state, capability) {
    this._state = state
    this._capability = capability
  }

  // service type
  static get type () {}

  /* persistence methods */

  toJSON () {}

  static async _genCapability () {}

  static async _identity (id) {
    return Identities.createIdentity({ id })
  }
}

module.exports = Service
