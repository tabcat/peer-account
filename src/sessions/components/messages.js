
'use strict'
const SessionManager = require('./sessionManager')
const Message = require('../message')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../../utils').setStatus(status)

class Messages extends SessionManager {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, { ...options, Session: Message })
    this.initialized = this._initialize()
  }

  get type () { return 'messages' }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      await this._attachState()

      if (this.options.load !== false) {
        this._getRecords(Message.type)
          .then(records => records.map(
            ({ recordId }) => this.contactBy(recordId))
          )
      }

      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Messages.type} failed initialization`)
    }
  }

  async messageBy (profile) {
    return this.sessionBy(profile.toString())
  }

  async messageOpen (offer, capability, options) {
    return this.sessionOpen(offer, capability, options)
  }
}

module.exports = Messages
