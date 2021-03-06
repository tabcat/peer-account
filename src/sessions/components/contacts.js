
'use strict'
const SessionManager = require('./sessionManager')
const Contact = require('../contact')
const SessionId = require('../sessionId')

const statuses = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}

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
      this.setStatus(statuses.INIT)
      await this._attachState()

      if (this.options.load !== false) {
        this._getRecords(Contact.type)
          .then(records => records.map(
            ({ recordId }) => this.sessionBy(
              recordId,
              { profilesComponent: this._account.profiles }
            )
          ))
      }

      this.setStatus(statuses.READY)
    } catch (e) {
      this.setStatus(statuses.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
      throw new Error('INIT_FAIL')
    }
  }

  async contactBy (profile) {
    await this.initialized
    return this.sessionBy(
      profile.toString(),
      { profilesComponent: this._account.profiles }
    )
  }

  async contactAdd (profile, options = {}) {
    await this.initialized
    const metadata = { ...options.metadata, origin: options.origin || profile }
    if (await this.existId(profile.toString())) {
      throw new Error('contact already added')
    }
    options = {
      ...options,
      metadata,
      recordId: profile.toString(),
      profilesComponent: this._account.profiles,
      sender: {
        ipfsAddr: options.ipfsAddr,
        profile: (await this._account.profiles.myProfile.address()).toString()
      },
      recipient: { profile: profile.toString() }
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
    await this.initialized
    return this.sessionAccept(
      offer,
      { ...options, handshake: { idKey: offer._channel.sessionId } }
    )
  }

  async _onOpenedSession (recordId) {
    const contact = await this.sessionBy(recordId)

    contact.events.once('status:CHECK_HANDSHAKE', async () => {
      const [record] =
        await this._queryRecords(record => record.recordId === recordId)
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
      this.log.debug(`contact ${contact.offer.sessionId} complete record added`)
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
