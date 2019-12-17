
'use strict'
const Component = require('../component')
const Index = require('../encryptedIndex')
const AsymChannel = require('../sessions/asymChannel')
const Contact = require('../sessions/contact')
const SessionName = require('../sessionName')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

const flatMap = (f, xs) =>
  xs.reduce((acc, x) =>
    acc.concat(f(x)), [])

class Contacts extends Component {
  constructor (orbitdbC, offer, capability, options) {
    super(orbitdbC, offer, capability, options)
    this._contacts = {}
    this._channels = {}
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      const aesKey = await Index.importKey(this.offer.aes)
      const dbAddr = await Index.determineAddress(
        this._orbitdbC._orbitdb,
        {
          name: this.offer.name,
          options: {
            ...this.options,
            accessController: {
              write: [this.offer.meta.owner.id]
            },
            meta: this.offer.meta
          }
        },
        aesKey
      )
      this._state = await Index.open(
        this._orbitdbC,
        dbAddr,
        aesKey,
        {
          identity: await this.constructor._identity(
            this.capability.idKey,
            this._orbitdbC._orbitdb.identity._provider
          )
        }
      )

      console.log(dbAddr.toString())

      if (this.options.load !== false) {
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
      throw new Error(`${Contacts.type} failed initialization`)
    }
  }

  static get type () { return 'contacts' }

  /*
    add a contact from an address of one of their channels for accepting
    contact offers.
    options.info is info to provide about yourself, like the address of your
    profile, with the contact offer. the owner of the channel recieving the
    contact offer can read the info and decide if they want to
    accept the offer.
    options.meta here is used to store information about the contact its
    sending the offer to. this could be anything the user wants like a name
    and other things that could be used to query the contact records.
  */
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
    await this._setRecord(
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

    this._contacts = { ...this._contacts, [contact.offer.name]: contact }
    this.events.emit('newContact', contact.offer.name)
    return this._contacts[contact.offer.name]
  }

  async openContact (sessionName) {
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
    if (!record.channelAddress && !record.session) {
      throw new Error(
        `contact ${name} record did not contain a channelAddress or session field`
      )
    }

    const contact = record.session
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

  // async closeContact () {}

  async createChannel (options = {}) {
    await this.initialized
    const channel = await AsymChannel.offer(
      this._orbitdbC,
      { supported: [Contact.type], log: this.log }
    )
    await AsymChannel.initialized
    await this._setRecord(
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

  async openChannel (sessionName) {
    if (!sessionName) throw new Error('sessionName must be defined')
    const { name, type } = SessionName.parse(sessionName)
    if (type !== AsymChannel.type) {
      throw new Error(
        `sessionName type must be '${AsymChannel.type}' but was '${type}'`
      )
    }
    if (this._channels[name]) return this._channels[name]

    const channelRecord = await this._matchRecord(name)
    if (!channelRecord) throw new Error('no record')
    if (!channelRecord.session) {
      throw new Error('channel record missing session field')
    }

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

  // async closeChannel () {}

  async contactOffer (sessionName) {
    if (!sessionName) throw new Error('sessionName must be defined')
    const { id } = SessionName.parse(sessionName)
    const offers = await Promise.all(
      Object.values(this.channels)
        .map((channel) => channel.getOffer(id))
    ).then(arr => arr.filter(v => v))
    if (offers.length > 1) {
      this.log.error('more than one channel with that offer')
    }
    return offers[0]
  }

  async contactOffers () {
    return Promise.all(
      Object.values(this.channels)
        .map((channel) => channel.getOffers())
    ).then(arrays => flatMap(a => a, arrays))
  }

  async acceptOffer (sessionName, options = {}) {
    if (!sessionName) throw new Error('sessionName must be defined')
    const { name } = SessionName.parse(sessionName)
    const contactOffer = await this.contactOffer(name)
    if (!contactOffer) throw new Error('offer does not exist')

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

    this._contacts = { ...this._contact, [contact.offer.name]: contact }
    this.events.emit('newContact', contact)
    return this._contacts[contact.offer.name]
  }

  get contacts () { return this._contacts }

  get channels () { return this._channels }

  async queryContacts (mapper) {
    return this._queryRecords(mapper)
  }

  async queryChannels (mapper) {
    return this._queryRecords(mapper)
  }

  // async declineRequest (requestId, options) {}
}

module.exports = Contacts
