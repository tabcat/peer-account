
'use strict'
const SessionManager = require('./sessionManager')
const Message = require('../message')

const statuses = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}

class Messages extends SessionManager {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, { ...options, Session: Message })
    this.initialized = this._initialize()
  }

  static get type () { return 'messages' }

  async _initialize () {
    try {
      this.setStatus(statuses.INIT)
      await this._attachState()

      if (this.options.load !== false) {
        this._getRecords(Message.type)
          .then(records => records.map(
            ({ recordId }) => this.messageBy(recordId))
          )
      }

      this.setStatus(statuses.READY)
    } catch (e) {
      this.setStatus(statuses.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
      throw new Error('INIT_FAIL')
    }
  }

  async messageBy (profile) {
    await this.initialized
    return this.sessionBy(profile.toString())
  }

  async messageOpen (offer, capability, options) {
    await this.initialized
    return this.sessionOpen(offer, capability, options)
  }

  async messageAccept (offer, options) {
    await this.initialized
    return this.sessionAccept(offer, options)
  }
}

module.exports = Messages
