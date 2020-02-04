
'use strict'
const SessionManager = require('./sessionManager')
const Contact = require('../contact')
const SessionId = require('../sessionId')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../../utils').setStatus(status)

class Contacts extends SessionManager {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, { ...options, Session: Contact })
    this._onOpenedSession = this._onOpenedSession.bind(this)
    this.events.on('openedSession', this._onOpenedSession)
    this.initialized = this._initialize()
  }

  static get type () { return 'contacts' }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      await this._attachState()

      if (this.options.load !== false) {
        this._getRecords(Contact.type)
          .then(records => records.map(
            ({ recordId }) => this.contactBy(recordId))
          )
      }

      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      console.error(e)
      this.log.error(e)
      throw new Error(`${Contacts.type} failed initialization`)
    }
  }

  async contactBy (profile, options) {
    return this.sessionBy(profile.toString(), { ...options, profilesComponent: this._account.profiles })
  }

  async contactAdd (profile, options = {}) {
    const metadata = { origin: options.origin || profile }
    if (await this.existId(profile.toString())) {
      throw new Error('contact already added')
    }
    options = {
      ...options,
      metadata,
      recordId: profile.toString(),
      profilesComponent: this._account.profiles,
      sender: (await this._account.profiles.myProfile.address()).toString(),
      recipient: profile.toString()
    }
    return this._contactFromAddress(profile, options)
  }

  async _contactFromAddress (address, options) {
    try {
      const dbAddr = this._orbitdbC.parseAddress(address)
      const sessionId = SessionId.parse(dbAddr.path)
      const offer = {
        sessionId: SessionId.generate(this.Session.type),
        [sessionId.type]: dbAddr.toString()
      }
      return this.sessionOpen(offer, null, options)
    } catch (e) {
      console.error(e)
      throw new Error('invalid address')
    }
  }

  async contactAccept (offer, options = {}) {
    return this.sessionAccept(offer, { ...options, handshake: { idKey: offer._channel.sessionId } })
  }

  async _onOpenedSession (recordId) {
    const contact = await this.sessionBy(recordId)

    contact.events.once('status:CHECK_HANDSHAKE', async () => {
      const record = await this._matchRecord(recordId)
      if (!record) {
        this.log.error(
          `${contact.offer.sessionId} is ready but record does not exist to update.`
        )
        return
      }
      await this._setRecord(
        contact.offer.sessionId,
        { ...record, session: contact.toJSON() }
      )
      this.log(`contact ${contact.offer.sessionId} complete record added`)
    })

    contact.events.once('status:READY', async () => {
      const { offer, capability } = await contact.message
      await this._account.messages.initialized
      if (!await this._account.messages.existId(recordId)) {
        await this._account.messages.messageAccept(
          offer,
          { capability, origin: contact.offer.sessionId, recordId }
        )
      }
    })
  }
}

module.exports = Contacts
