
'use strict'
const Session = require('./session')

class ContactSession extends Session {
  constructor (orbitdbC, db, capability) {
    super(db, capability)
    this._orbitdbC = orbitdbC
    this._setup = null
    this._comms = null
    this._sessions = {}
    this._initialized = this._initialize()
  }

  async _initialize () {
    try {
      this.status =
    } catch (e) {
      this.events.emit('err', 'contact session init failed')
    }
  }

  // session type
  static get type () { return 'contact' }

  /* persistence methods */

  static async _genCapability () {

  }

  /* factory methods */

  static async open (orbitdbC, address, capability, options) {

  }

  static async offer (orbitdbC, options) {

  }

  static async accept () {}

  static async decline () {}

  /* state methods */

  async sendOffer (offer) {}

  async acceptOffer (offerId) {}

  async declineOffer (offerId) {}

  async openSession () {}
}

module.exports = ContactSession
