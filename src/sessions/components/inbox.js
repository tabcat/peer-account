
'use strict'
const Component = require('./component')
const AsymChannel = require('../asymChannel')
const Contact = require('../contact')
// const SessionName = require('../sessionName')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../../utils').setStatus(status)

class Inbox extends Component {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, options)
    this.inbox = null
    this.initialized = this._initialize()
  }

  static get type () { return 'inbox' }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      await this._attachState()

      const inboxSession = await this._matchRecord('inbox')
      if (!inboxSession) {
        this.inbox = await AsymChannel.offer(
          this._orbitdbC,
          { ...this.options, supported: [Contact.type], log: this.log }
        )
        await this._setRecord('inbox', this.inbox.toJSON())
      } else {
        this.inbox = await AsymChannel.open(
          this._orbitdbC,
          inboxSession.offer,
          inboxSession.capability,
          { ...this.options, log: this.log }
        )
      }
      await Promise.all([
        this.inbox.initialized,
        this._account.profiles.initialized
      ])

      const myProfile = this._account.profiles.myProfile
      const inboxAddress = await myProfile.getField('inbox')
      const address = await this.inbox.address()
      if (inboxAddress !== address) {
        await myProfile.setField('inbox', address.toString())
      }

      this.inbox._state.events.on(
        'replicated',
        () => this.events.emit('replicated')
      )

      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Inbox.type} failed initialization`)
    }
  }

  async inboxAddress () {
    await this.initialized
    return this.inbox.address
  }

  async inboxRead () {
    return this.inbox.getOffers()
  }

  async inboxQuery (mapper) {
    return this.inboxRead()
      .then(inbox => inbox.filter(mapper))
      .catch(e => { this.log.error(e); throw e })
  }
}

module.exports = Inbox
