
'use strict'
const QueueComponent = require('./queueComponent')
const Contact = require('../contact')
const SessionName = require('../sessionName')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../../utils').setStatus(status)

class Contacts extends QueueComponent {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, options)
    this._contacts = {}
    this._queue = { _contactAdd: {}, _contactOpen: {}, _contactAccept: {} }
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      await this._account.profiles.initialized
      setStatus(this, status.INIT)
      await this._attachState()

      if (this.options.load !== false) {
        this._getRecords(Contact.type)
          .then(docs => docs.map((doc) => this.openContact(doc.name)))
      }

      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Contacts.type} failed initialization`)
    }
  }

  static get type () { return 'contacts' }

  contactAdd (profileAddress, options = {}) {
    const funcKey = '_contactAdd'
    return this._queueHandler({ funcKey, params: [profileAddress, options] })
  }

  contactOpen (sessionName) {
    const funcKey = '_contactOpen'
    return this._queueHandler({ funcKey, params: [sessionName] })
  }

  contactAccept (sessionName) {
    const funcKey = '_contactAccept'
    return this._queueHandler({ funcKey, params: [sessionName] })
  }

  async recordsRead () {
    return this._getRecords(Contact.type)
  }

  async recordsQuery (mapper) {
    return this.recordsRead()
      .then(records => records.filter(mapper))
      .catch(e => { this.log.error(e); throw e })
  }

  _onCheckHandshake (contact) {
    // persist offer and capability when ready
    contact.events.once('status:CHECK_HANDSHAKE', async () => {
      const record = await this._matchRecord(contact.offer.name)
      if (!record) {
        this.log.error(
          `contact ${contact.offer.name} is ready but record does not exist to update.`
        )
        return
      }
      await this._setRecord(
        contact.offer.name,
        {
          ...record,
          session: contact.toJSON()
        }
      )
      this.log(`contact ${contact.offer.name} complete record added`)
    })
  }

  async _contactAdd (profileAddress, options = {}) {
    await this.initialized
    if (!profileAddress) throw new Error('profileAddress must be defined')
    if (!this._orbitdbC.isValidAddress(profileAddress)) {
      throw new Error(
        `profileAddress ${profileAddress} is not a valid orbitdb address`
      )
    }
    const [exists] = await this._queryRecords(
      doc => doc.profileAddress === profileAddress,
      Contact.type
    )
    if (exists) return this.openContact(exists.name)
    const sProfileAddress = await this._account.profiles.myProfile.address()
    const rProfileAddress = this._orbitdbC.parseAddress(profileAddress)
    const contact = await Contact.fromProfile(
      this._orbitdbC,
      profileAddress,
      {
        log: this.log,
        name: options.name,
        info: options.info,
        profilesComponent: this._account.profiles,
        sender: { profile: sProfileAddress.toString() },
        recipient: { profile: rProfileAddress.toString() }
      }
    )

    await this._setRecord(
      contact.offer.name,
      {
        name: contact.offer.name,
        info: options.info,
        profileAddress,
        origin: options.origin || profileAddress,
        meta: options.meta || {}
      }
    )
    this.log(`contact ${contact.offer.name} partial record added`)

    // persist offer and capability when ready
    this._onCheckHandshake(contact)

    this._contacts = { ...this._contacts, [contact.offer.name]: contact }
    this.events.emit('added', contact.offer.name)
    this.events.emit('contactNew', contact.offer.name)
    return this._contacts[contact.offer.name]
  }

  async _contactOpen (sessionName) {
    if (!sessionName) throw new Error('sessionName must be defined')
    const { name, type } = SessionName.parse(sessionName)
    if (type !== Contact.type) {
      throw new Error(
        `sessionName type must be '${Contact.type}' but was '${type}'`
      )
    }
    if (this._contacts[name]) return this._contacts[name]

    const record = await this._matchRecord(name)
    if (!record) throw new Error(`no record for contact ${name}`)
    if (!record.profileAddress) {
      throw new Error(
        `contact ${name} record did not contain a profileAddress field`
      )
    }

    const contact = record.session
      ? await Contact.open(
        this._orbitdbC,
        record.session.offer,
        record.session.capability,
        { log: this.log }
      )
      : (async () => {
        await this._account.profiles.initialized
        const contact = Contact.fromAddress(
          this._orbitdbC,
          record.profileAddress,
          {
            log: this.log,
            name: record.name,
            info: record.info,
            profile: await this._account.profiles.myProfile.address()
          }
        )
        this._onCheckHandshake(contact)
        return contact
      })()

    this._contacts = { ...this._contacts, [name]: contact }
    return this._contacts[name]
  }

  async _contactAccept (contactOffer, options = {}) {
    await this.initialized
    if (!contactOffer) throw new Error('offer does not exist')

    if (
      !contactOffer.recipient && !contactOffer.recipient.profile &&
      contactOffer.recipient.profile !==
      (await this._account.profiles.myProfile.address()).toString()
    ) throw new Error('recipient mismatch')

    const contact = await Contact.accept(
      this._orbitdbC,
      contactOffer,
      {
        log: this.log,
        handshake: { idKey: contactOffer._channel.name }
      }
    )
    await contact.initialized
    await this._setRecord(
      contact.offer.name,
      {
        name: contact.offer.name,
        channelAddress: contactOffer._channel.address,
        origin: options.origin || contactOffer._channel.address,
        session: contact.toJSON(),
        meta: options.meta || {}
      }
    )
    this.log(`contact ${contact.offer.name} complete record added`)

    this._contacts = { ...this._contacts, [contact.offer.name]: contact }
    this.events.emit('accepted', contact)
    this.events.emit('contactNew', contact)
    return this._contacts[contact.offer.name]
  }
}

module.exports = Contacts
