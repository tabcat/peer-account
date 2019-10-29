
'use strict'
const EventEmitter = require('events').EventEmitter
const AsymChannel = require('../sessions/asymChannel')
const Contact = require('../sessions/contact')

class Contacts {
  constructor (orbitdbC, index, options = {}) {
    this._orbitdbC = orbitdbC
    this._index = index
    this.options = options
    this._contacts = {}
    this._channels = {}
    this.events = new EventEmitter()
    this.initialized = this.initialize()
  }

  async initialize () {
    try {
      return Promise.all([
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
    } catch (e) {
      console.error(e)
      this.events.emit('error', 'init failed')
    }
  }

  static get indexKey () { return 'contacts' }

  static async attach (account) {
    if (!account) throw new Error('account must be defined')
    const contacts = new Contacts(
      account._orbitdbC,
      await account.componentIndex(this.indexKey)
    )
    await contacts.initialized
    return contacts
  }

  async openContact (name) {
    if (this._contacts[name]) return this._contacts[name]
    const contactRecord = await this._matchRecord(name)
    if (!contactRecord) throw new Error('contact record not found')
    const { session, options } = contactRecord
    const contact = await Contact.open(
      this._orbitdbC,
      session.offer,
      session.capability,
      options
    )
    this._contacts = { ...this._contacts, [name]: contact }
    return this._contacts[name]
  }

  async openChannel (name) {
    if (this._channels[name]) return this._channels[name]
    const channelRecord = await this._matchRecord(name)
    if (!channelRecord) throw new Error('channel record not found')
    const { session, options } = channelRecord
    const channel = await AsymChannel.open(
      this._orbitdbC,
      session.offer,
      session.capability,
      options
    )
    this._channels = { ...this._channels, [name]: channel }
    return this._channels[name]
  }

  async addContact (channelAddress, options = {}) {
    const { origin, meta, ...contactOptions } = options
    const channel = await AsymChannel.fromAddress(
      this._orbitdbC,
      channelAddress,
      contactOptions
    )
    await channel.initialized
    const contact = await Contact.offer(
      this._orbitdbC,
      { ...contactOptions, recipient: channel._state.options.meta.owner.id }
    )
    await Promise.all([
      channel.sendOffer(contact.offer),
      this._index.set(
        contact.offer.name,
        {
          name: contact.offer.name,
          origin: options.origin || channelAddress,
          session: contact.toJSON(),
          meta: meta || {}
        }
      )
    ])
    console.log(`to accept the contact request you just sent,
      paste this in the tab you copied the code to add the contact from:
      'await user.contacts.acceptOffer('${contact.offer.name}')'
      `)
    this.events.emit('newContact', contact)
    return contact
  }

  async createChannel (options = {}) {
    await this.initialized
    const { retired, meta, ...channelOptions } = options
    options = { ...channelOptions, supported: ['contact'] }
    const channel = await AsymChannel.offer(this._orbitdbC, options)
    await this._index.set(
      channel.offer.name,
      {
        name: channel.offer.name,
        options,
        session: channel.toJSON(),
        retired: retired || false,
        meta: meta || {}
      }
    )
    this._channels = { ...this._channels, [channel.offer.name]: channel }
    this.events.emit('newChannel', channel.offer.name)
    return this.openChannel(channel.offer.name, options)
  }

  // async retireSpawner (name, options) {
  //   await this.initialized
  //   if (!await this.spawner(name)) {
  //     throw new Error('spawner with that name does not exist')
  //   }
  //   if (this._spawners[name]) {
  //     this._spawners[name].stop()
  //     delete this.spawners[name]
  //   }
  //   const spawnerRecord = await this._matchRecord('spawner', name)
  //   this._index.set({
  //     ...spawnerRecord,
  //     retired: true
  //   })
  //   this.events.emit('retiredSpawner', name)
  // }

  async offers () {
    const channelOffers = await Promise.all(
      Object.keys(this._channels)
        .map(async (name) => [name, await this._channels[name].getOffers()])
    )
    return channelOffers.reduce(
      (acc, cur) => ({ ...acc, [cur[0]]: cur[1] }),
      {}
    )
  }

  async acceptOffer (name, options = {}) {
    const { origin, meta, ...contactOptions } = options
    const [channelKey, offer] = (await Promise.all(
      Object.keys(this._channels)
        .map(async (key) => [key, await this._channels[key].getOffer(name)])
    ).then(offers => offers.filter(offer => offer[1])))[0] // remove undefined
    if (!offer) throw new Error('offer does not exist')
    const idKey = this._channels[channelKey].offer.name
    const contact = await Contact.accept(this._orbitdbC, offer, { ...contactOptions, idKey })
    await this._index.set(
      contact.offer.name,
      {
        name: contact.offer.name,
        origin: options.origin || channelKey,
        session: contact.toJSON(),
        meta: meta || {}
      }
    )
    this.events.emit('newContact', contact)
    return contact
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
