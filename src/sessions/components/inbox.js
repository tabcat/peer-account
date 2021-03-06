
'use strict'
const Component = require('./component')
const AsymChannel = require('../asymChannel')
const Contact = require('../contact')

const statuses = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}

class Inbox extends Component {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, options)
    this.myInbox = null
    this.initialized = this._initialize()
  }

  static get type () { return 'inbox' }

  async _initialize () {
    try {
      this.setStatus(statuses.INIT)
      await this._attachState()

      const inboxSession = await this._matchRecord('inbox')
      if (!inboxSession) {
        this.myInbox = await AsymChannel.offer(
          this._orbitdbC,
          { ...this.options, supported: [Contact.type] }
        )
        await this._setRecord('inbox', this.myInbox.toJSON())
      } else {
        this.myInbox = await AsymChannel.open(
          this._orbitdbC,
          inboxSession.offer,
          inboxSession.capability,
          { ...this.options }
        )
      }
      await Promise.all([
        this.myInbox.initialized,
        this._account.profiles.initialized
      ])

      const myProfile = this._account.profiles.myProfile
      const inboxAddress = await myProfile.getField('inbox')
      const address = await this.myInbox.address()
      if (inboxAddress !== address) {
        await myProfile.setField('inbox', address.toString())
      }

      this.myInbox._state.events.on(
        'replicated',
        () => this.events.emit('replicated')
      )

      this.setStatus(statuses.READY)
    } catch (e) {
      this.setStatus(statuses.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
      throw new Error('INIT_FAIL')
    }
  }

  async inboxAddress () {
    await this.initialized
    return this.myInbox.address
  }

  async inboxRead () {
    return this.myInbox.getOffers()
  }

  async inboxQuery (mapper) {
    return this.inboxRead()
      .then(inbox => inbox.filter(mapper))
      .catch(e => { this.log.error(e); throw e })
  }
}

module.exports = Inbox
