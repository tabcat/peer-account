
'use strict'
const Session = require('../session')
const AsymChannel = require('./asymChannel')
const Handshake = require('./handshake')
const SymChannel = require('./symChannel')
const Message = require('./message')
const Profile = require('./profile')
const SessionName = require('../sessionName')
const Index = require('../encryptedIndex')
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  INIT: 'INIT',
  SEND_OFFER: 'SEND_OFFER',
  CHECK_HANDSHAKE: 'CHECK_HANDSHAKE',
  HANDSHAKE: 'HANDSHAKE',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class Contact extends Session {
  constructor (orbitdbC, offer, capability, options = {}) {
    super(orbitdbC, offer, capability, options)
    this.profile = null
    this.channel = null
    this.message = null
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      // handles fromAddress creation
      if (this.offer.name && this.offer.channel && !this.offer.meta) {
        setStatus(this, status.SEND_OFFER)
        const asymChannel = await AsymChannel.fromAddress(
          this._orbitdbC,
          this.offer.channel,
          { log: this.log }
        )
        await asymChannel.initialized
        if (!asymChannel.isSupported(Contact.type)) {
          throw new Error(`channel does not support ${Contact.type} offers`)
        }
        if (await asymChannel.getOffer(this.offer.name)) {
          throw new Error(`contact offer ${this.offer.name} already exits`)
        }
        const capability = await Contact.createCapability(
          {
            identityProvider: this._orbitdbC._orbitdb.identity._provider,
            ...this.options,
            name: this.offer.name
          }
        )
        const offer = await Contact.createOffer(
          capability,
          {
            ...this.options,
            [Handshake.type]: {
              sender: capability[Handshake.type].id,
              recipient: asymChannel.offer.meta.owner.id
            }
          }
        )
        await asymChannel.sendOffer(offer)
        this.log(`offer ${offer.name} sent to asymChannel`)
        this._offer = offer
        this._capability = capability
        this.log('contact offer sent')
      }

      setStatus(this, status.CHECK_HANDSHAKE)
      const handshake = await Handshake.open(
        this._orbitdbC,
        this.offer[Handshake.type],
        this.capability[Handshake.type],
        { log: this.log, start: false }
      )

      await handshake.initialized

      if (handshake.status !== 'CONFIRMED') {
        setStatus(this, status.HANDSHAKE)
        await handshake.start()
        const onHandshakeFail = () => { throw new Error('handshake failed') }
        handshake.events.once('status:FAILED', onHandshakeFail)
        await new Promise((resolve) => {
          handshake.events.once('status:CONFIRMED', () => {
            resolve()
            handshake.events.removeListener('status:FAILED', onHandshakeFail)
          })
        })
        this.log('handshake completed')
      }

      const shake = await handshake.state()
      const aesKey = await crypto.aes.importKey(new Uint8Array(shake.aes))
      const idKey = shake.idKey
      const myRole = handshake.direction
      const theirRole = myRole === 'recipient' ? 'sender' : 'recipient'

      const dbAddr = await Index.determineAddress(
        this._orbitdbC._orbitdb,
        {
          name: this.offer.name,
          options: {
            ...this.options,
            accessController: {
              write: [shake.sender.id, shake.recipient.id]
            },
            meta: this.offer.meta
          }
        },
        aesKey
      )
      const state = await Index.open(
        this._orbitdbC,
        dbAddr,
        aesKey,
        {
          identity: await this.constructor._identity(
            idKey,
            this._orbitdbC._orbitdb.identity._provider
          )
        }
      )
      this._state = state

      const symChannelCapability = await SymChannel.createCapability(
        {
          name: this.offer[SymChannel.type].name,
          aesKey,
          idKey,
          identityProvider: this._orbitdbC._orbitdb.identity._provider
        }
      )
      const symChannelOffer = await SymChannel.createOffer(
        symChannelCapability,
        {
          sender: shake.sender.id,
          recipient: shake.recipient.id,
          supported: ['*']
        }
      )
      const symChannel = await SymChannel.open(
        this._orbitdbC,
        symChannelOffer,
        symChannelCapability,
        { log: this.log }
      )

      const messageCapability = await SymChannel.createCapability(
        {
          name: this.offer[Message.type].name,
          aesKey,
          idKey,
          identityProvider: this._orbitdbC._orbitdb.identity._provider
        }
      )
      const messageOffer = await Message.createOffer(
        messageCapability,
        {
          sender: shake.sender.id,
          recipient: shake.recipient.id
        }
      )
      const message = await Message.open(
        this._orbitdbC,
        messageOffer,
        messageCapability,
        { log: this.log }
      )

      const profileDocKey = (role) => `${Profile.type}-${role}`
      if (!await this._state.match(profileDocKey(myRole))) {
        await this._state.set(
          profileDocKey(myRole),
          this.capability.profile
        )
      }
      if (!await this._state.match(profileDocKey(theirRole))) {
        await new Promise(resolve => {
          const onReplicated = async () => {
            if (await this._state.match(profileDocKey(theirRole))) {
              this._state._docstore.events.removeListener(
                'replicated',
                onReplicated
              )
              resolve()
            }
          }
          this._state._docstore.events.on('replicated', onReplicated)
        })
      }
      const profileDoc = await this._state.match(profileDocKey(theirRole))
      if (!profileDoc) {
        throw new Error('their profile doc should be defined now')
      }
      const profile = await Profile.accept(this._orbitdbC, profileDoc)

      await Promise.all([
        symChannel.initialized, message.initialized, profile.initialized
      ])

      this.channel = symChannel
      this.message = message
      this.profile = profile

      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Contact.type} failed initialization`)
    }
  }

  static get type () { return 'contact' }

  static async createOffer (capability, options = {}) {
    if (!await this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }

    return {
      name: capability.name,
      [Handshake.type]: await Handshake.createOffer(
        capability[Handshake.type],
        options[Handshake.type]
      ),
      [SymChannel.type]: { name: capability[SymChannel.type].name },
      meta: { sessionType: this.type },
      info: options.info || {}
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name || !SessionName.isValid(offer.name)) return false
    if (SessionName.parse(offer.name).type !== this.type) return false
    if (!offer.meta || !offer.info) return false
    if (
      !offer[Handshake.type] ||
      !await Handshake.verifyOffer(offer[Handshake.type])
    ) return false
    if (!offer[SymChannel.type] || !offer[SymChannel.type].name) return false
    if (!SessionName.isValid(offer[SymChannel.type].name)) return false
    if (
      SessionName.parse(offer[SymChannel.type].name).type !== SymChannel.type
    ) return false
    return true
  }

  static async createCapability (options = {}) {
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    if (!options.profile) throw new Error('options.profile must be defined')
    if (!Profile.verifyOffer(options.profile)) {
      throw new Error('invalid profile offer')
    }
    const fromOffer = options.offer && await this.verifyOffer(options.offer)

    const name = fromOffer
      ? options.offer.name
      : options.name || SessionName.generate(this.type).toString()
    const handshakeOffer = fromOffer
      ? options.offer[Handshake.type]
      : undefined
    const symChannelName = fromOffer
      ? options.offer[SymChannel.type].name
      : options[SymChannel.type] && options[SymChannel.type].name
        ? options[SymChannel.type].name
        : SessionName.generate(SymChannel.type).name
    const messageName = fromOffer
      ? options.offer[Message.type].name
      : options[Message.type] && options[Message.type].name
        ? options[Message.type].name
        : SessionName.generate(Message.type).name

    const idKey = options.idKey || name
    const identity = await this._identity(idKey, options.identityProvider)

    return {
      name,
      idKey,
      id: identity.id,
      [Handshake.type]: await Handshake.createCapability(
        {
          identityProvider: options.identityProvider,
          ...(options[Handshake.type] || {}),
          offer: handshakeOffer
        }
      ),
      [SymChannel.type]: { name: symChannelName },
      [Message.type]: { name: messageName },
      [Profile.type]: options.profile
    }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.name || !SessionName.isValid(capability.name)) return false
    if (SessionName.parse(capability.name).type !== this.type) return false
    if (!capability.idKey || !capability.id) return false
    if (!Handshake.verifyCapability(capability[Handshake.type])) return false
    if (
      !capability[SymChannel.type] || !capability[SymChannel.type].name
    ) return false
    if (!SessionName.isValid(capability[SymChannel.type].name)) return false
    if (
      SessionName.parse(capability[SymChannel.type].name).type !==
        SymChannel.type
    ) return false
    if (
      !capability[Message.type] || !capability[Message.type].name
    ) return false
    if (!SessionName.isValid(capability[Message.type].name)) return false
    if (
      SessionName.parse(capability[Message.type].name).type !==
        Message.type
    ) return false
    if (
      !capability[Profile.type] ||
      !await Profile.verifyOffer(capability[Profile.type])
    ) return false
    return true
  }

  // creates an instance from a channel address that accepts contact offers
  static fromAddress (orbitdbC, address, options = {}) {
    const offer = {
      name: SessionName.generate(this.type).name,
      channel: address
    }
    return new Contact(
      orbitdbC,
      offer,
      null,
      options
    )
  }
}

module.exports = Contact
