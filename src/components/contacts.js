
'use strict'
const EventEmitter = require('events').EventEmitter
const AsymChannel = require('../sessions/asymChannel')
const Contact = require('../sessions/contact')
const OfferName = require('./offerName')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)
const setLogOutputs = require('../utils').setLogOutput

class Contacts {
  constructor (orbitdbC, index, options = {}) {
    if (!orbitdbC) throw new Error('account must be defined')
    if (!index) throw new Error('index must be defined')
    this._orbitdbC = orbitdbC
    this._index = index
    this.options = options
    this._contacts = {}
    this._channels = {}
    this.events = new EventEmitter()
    this.initialized = this._initialize()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, this.indexKey, options.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      if (this.options.load) {
        await Promise.all([
          this._getRecords(Contact.type)
            .then(docs => Promise.all(
              docs.map((doc) => this.openContact(doc.name))
            )),
          this._getRecords(AsymChannel.type)
            .then(docs => docs.filter(doc => !doc.retired))
            .then(docs => Promise.all(
              docs.map((doc) => this.openChannel(doc.name))
            ))
        ])
      }
      setStatus(this, status.READY)
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
      throw new Error(`${Contacts.indexKey} failed initialization`)
    }
  }

  static get indexKey () { return 'contacts' }

  static async attach (account, options) {
    if (!account) throw new Error('account must be defined')
    const contacts = new Contacts(
      account,
      await account.componentIndex(this.indexKey),
      { log: account.log, load: options.load }
    )
    await contacts.initialized
    account[this.indexKey] = contacts
  }

  async addContact (channelAddress, options = {}) {
    await this.initialized
    if (!channelAddress) throw new Error('channelAddress must be defined')
    if (!this._orbitdbC.isValidAddress(channelAddress)) {
      throw new Error(
        `channelAddress ${channelAddress} is not a valid orbitdb address`
      )
    }
    const contact = await Contact.fromAddress(
      this._orbitdbC,
      channelAddress,
      { log: this.log, info: options.info }
    )
    await this._index.set(
      contact.offer.name,
      {
        name: contact.offer.name,
        info: options.info,
        channelAddress,
        origin: options.origin || channelAddress,
        meta: options.meta || {}
      }
    )
    this.log(`contact ${contact.offer.name} partial record added`)

    // persist offer and capability
    contact.events.once('status:CHECK_HANDSHAKE', async () => {
      const record = await this._matchRecord(contact.offer.name)
      if (!record) {
        this.log.error(
          `contact ${contact.offer.name} is ready but record does not exist to update.`
        )
        return
      }
      await this._index.set(
        contact.offer.name,
        {
          ...record,
          session: contact.toJSON()
        }
      )
      this.log(`contact ${contact.offer.name} session field added to record`)
    })

    this._contacts = { ...this._contacts, [contact.offer.name]: contact }
    this.events.emit('newContact', contact.offer.name)
    return this._contacts[contact.offer.name]
  }

  async openContact (offerName) {
    if (!offerName) throw new Error('offerName must be defined')
    const { name, type } = OfferName.parse(offerName)
    if (type !== Contact.type) {
      throw new Error(
        `offerName type must be '${Contact.type}' but was '${type}'`
      )
    }
    if (this._contacts[name]) return this._contacts[name]
    const record = await this._matchRecord(name)
    if (!record) throw new Error(`no record for contact ${name}`)
    if (!record.channelAddress && !record.session) {
      throw new Error(
        `contact ${name} record did not contain a channelAddress or session field`
      )
    }

    const contact = record.sessions
      ? await Contact.open(
        this._orbitdbC,
        record.session.offer,
        record.session.capability,
        { log: this.log }
      )
      : await Contact.fromAddress(
        this._orbitdbC,
        record.channelAddress,
        { log: this.log, info: record.info }
      )

    this._contacts = { ...this._contacts, [name]: contact }
    return this._contacts[name]
  }

  async closeContact () {}

  async createChannel (options = {}) {
    await this.initialized
    const channel = await AsymChannel.offer(
      this._orbitdbC,
      { supported: [Contact.type], log: this.log }
    )
    await this._index.set(
      channel.offer.name,
      {
        name: channel.offer.name,
        options: options,
        session: channel.toJSON(),
        retired: options.retired || false,
        meta: options.meta || {}
      }
    )

    this._channels = { ...this._channels, [channel.offer.name]: channel }
    this.events.emit('newChannel', channel.offer.name)
    return this._channels[channel.offer.name]
  }

  async openChannel (offerName) {
    if (!offerName) throw new Error('offerName must be defined')
    const { name, type } = OfferName.parse(offerName)
    if (type !== AsymChannel.type) {
      throw new Error(
        `offerName type must be '${AsymChannel.type}' but was '${type}'`
      )
    }
    if (this._channels[name]) return this._channels[name]
    const channelRecord = await this._matchRecord(name)
    if (!channelRecord) throw new Error('no record')

    const { session } = channelRecord
    const channel = await AsymChannel.open(
      this._orbitdbC,
      session.offer,
      session.capability,
      { log: this.log }
    )

    this._channels = { ...this._channels, [name]: channel }
    return this._channels[name]
  }

  async closeChannel () {}

  async contactOffer (offerName) {
    if (!offerName) throw new Error('offerName must be defined')
    const { name } = OfferName.parse(offerName)
    const offers = await Promise.all(
      Object.values(this._channels)
        .map(async (channel) => channel.getOffer(name))
    ).then(arr => arr.filter(v => v))
    if (offers.length > 1) {
      throw new Error('more than one channel with that offer')
    }
    return offers[0]
  }

  async contactOffers () {
    return Promise.all(
      Object.values(this._channels)
        .map(async (channel) => channel.getOffers())
    ).then(arr => arr.flatMap(a => a))
  }

  async acceptOffer (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    const { name } = OfferName.parse(offerName)
    const contactOffer = await this.contactOffer(name)
    if (!contactOffer) throw new Error('offer does not exist')

    const contact = await Contact.accept(
      this._orbitdbC,
      contactOffer,
      { idKey: contactOffer._channel.name, log: this.log }
    )
    await this._index.set(
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

    this._contacts = { ...this._contact, [contact.offer.name]: contact }
    this.events.emit('newContact', contact)
    return this._contacts[contact.offer.name]
  }

  get contacts () { return this._contacts }

  get channels () { return this._channels }

  async queryContacts (mapper) {
    if (typeof mapper !== 'function') {
      throw new Error('mapper must be type function')
    }
    const records = await this._getRecords(Contact.type)
    return records.filter(mapper)
  }

  async queryChannels (mapper) {
    if (typeof mapper !== 'function') {
      throw new Error('mapper must be type function')
    }
    const records = await this._getRecords(AsymChannel.type)
    return records.filter(mapper)
  }

  // async declineRequest (requestId, options) {}

  async _matchRecord (recordId = '') {
    return this._index.match(recordId)
  }

  async _getRecords (recordType) {
    return this._index.get(recordType)
  }
}

module.exports = Contacts
