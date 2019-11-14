
'use strict'
const Session = require('./session')
const AsymChannel = require('./asymChannel')
const Handshake = require('./handshake')
const SymChannel = require('./symChannel')
const Index = require('../encryptedIndex')
const OfferName = require('./offerName')
const EventEmitter = require('events').EventEmitter
const crypto = require('@tabcat/peer-account-crypto')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  SEND_OFFER: 'SEND_OFFER',
  CHECK_HANDSHAKE: 'CHECK_HANDSHAKE',
  HANDSHAKE: 'HANDSHAKE',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)
const setLogOutputs = require('../utils').setLogOutput

const supported = {
  [SymChannel.type]: SymChannel
}

class Contact extends Session {
  constructor (orbitdbC, db, offer, capability, options = {}) {
    super(db, offer, capability, options)
    this._orbitdbC = orbitdbC
    this._channel = null
    this._sessions = {}
    this.events = new EventEmitter()
    this.initialized = this.initialize()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, Contact.type, options.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
  }

  async initialize () {
    try {
      setStatus(this, status.INIT)
      if (!this.offer.recipient) {
        throw new Error('offer does not have a recipient')
      }
      // handles fromAddress creation
      if (this.offer.name && this.offer.channel && !this.offer.meta) {
        setStatus(this, status.SEND_OFFER)
        const asymChannel = await AsymChannel.fromAddress(
          this._orbitdbC,
          this.offer.channel
        )
        if (!asymChannel.isSupported(Contact.type)) {
          throw new Error(`channel does not support ${Contact.type} offers`)
        }
        if (await asymChannel.getOffer(this.offer.name)) {
          throw new Error(`contact offer ${this.offer.name} already exits`)
        }
        const handshakeName = OfferName.generate(Handshake.type).name
        const capability = await Contact._genCapability(
          this.offer.name,
          {
            identityProvider: this._orbitdbC._orbitdb.identity._provider,
            idKey: this.offer.name,
            aesKey: await crypto.aes.generateKey(128),
            [Handshake.type]: {
              name: handshakeName,
              identityProvider: this._orbitdbC._orbitdb.identity._provider,
              idKey: asymChannel.capability.idKey,
              curve: this.options[Handshake.type].curve
            }
          }
        )
        const offer = await Contact._createOffer(
          this.offer.name,
          {
            [Handshake.type]: {
              name: handshakeName,
              sender: capability.id,
              recipient: asymChannel.offer.meta.owner.id,
              curve: capability[Handshake.type].curve
            },
            [SymChannel.type]: {
              name: OfferName.generate(SymChannel.type)
            },
            info: this.options.info || {}
          }
        )
        await asymChannel.sendOffer(offer)
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
        handshake.start()
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

      const symChannel = await SymChannel.open(
        this._orbitdbC,
        await SymChannel._createOffer(
          this.offer[SymChannel.type].name,
          {
            aesKey,
            sender: shake.sender.id,
            reciever: shake.recipient.id,
            supported
          }
        ),
        await SymChannel._genCapability(
          this.offer[SymChannel.type].name,
          { idKey }
        )
      )

      const stateAesKey = await crypto.aes.importKey(new Uint8Array(
        this.capability.aes
      ))
      const stateIdentity = await Contact._identity(
        this.capability.idKey,
        this._orbitdbC._orbitdb.identity._provider
      )
      const state = await Index.determineAddress(
        this._orbitdbC._orbitdb,
        {
          name: this.offer.name,
          type: 'docstore',
          options: {
            identity: stateIdentity,
            accessController: { write: [stateIdentity.id] },
            meta: this.offer.meta
          }
        },
        stateAesKey
      ).then(addr => Index.openIndex(this._orbitdbC, addr, stateAesKey))

      if (!await state.match(symChannel.offer.name)) {
        await state.set(
          symChannel.offer.name,
          {
            name: symChannel.offer.name,
            session: symChannel.toJSON()
          }
        )
      }

      this._state = state
      this._channel = symChannel

      setStatus(this, status.READY)
    } catch (e) {
      this.log.error(e)
      this.log.error('failed to initialize contact')
      setStatus(this, status.FAILED)
    }
  }

  // session type
  static get type () { return 'contact' }

  /* persistence methods */

  static async _createOffer (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (!options[Handshake.type]) {
      throw new Error(`options.${Handshake.type} must be defined`)
    }
    if (!options[SymChannel.type]) {
      throw new Error(`options.${SymChannel.type} must be defined`)
    }
    if (!OfferName.isValid(options[SymChannel.type].name)) {
      throw new Error(`invalid ${SymChannel.type} offer name`)
    }

    return {
      name: offerName.name,
      [Handshake.type]: await Handshake._createOffer(
        options[Handshake.type].name,
        {
          sender: options[Handshake.type].sender,
          recipient: options[Handshake.type].recipient,
          curve: options[Handshake.type].curve
        }
      ),
      [SymChannel.type]: {
        name: options[SymChannel.type].name
      },
      meta: { sessionType: this.type },
      info: options.info || {}
    }
  }

  static async verifyOffer (orbitdbC, offer, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    if (!offer.name) return false
    if (OfferName.parse(offer.name).type !== this.type) return false
    if (!offer[Handshake.type] || !offer[SymChannel.type]) return false
    if (!offer.meta || !offer.info) return false
    return true
  }

  static async _genCapability (offerName, options = {}) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (offerName.type !== this.type) throw new Error('invalid offerName type')
    if (!options[Handshake.type]) {
      throw new Error(`options.${Handshake.type} must be defined`)
    }
    const idKey = options.idKey || offerName.name
    const identity = await this._identity(idKey, options.identityProvider)
    const aesKey = options.aesKey || await crypto.aes.generate(options.keyLen)

    return {
      idKey,
      id: identity.id,
      aes: [...aesKey],
      [Handshake.type]: await Handshake._genCapability(
        options[Handshake.type].name,
        {
          identityProvider: options[Handshake.type].identityProvider,
          idKey: options[Handshake.type].idKey,
          curve: options[Handshake.type].curve
        }
      )
    }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.idKey || !capability.id || !capability.aes) return false
    if (!capability[Handshake.type]) return false
    return true
  }

  /* factory methods */

  static async open (orbitdbC, offer, capability, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    if (!capability) throw new Error('capability must be defined')
    if (!await this.verifyOffer(orbitdbC, offer)) {
      throw new Error(`tried to open ${this.type} session with invalid offer`)
    }
    if (!await this.verifyCapability(capability)) {
      throw new Error(
        `tried to open ${this.type} session with invalid capability`
      )
    }
    return new Contact(
      orbitdbC,
      null,
      offer,
      capability,
      { log: options.log }
    )
  }

  static async offer (orbitdbC, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!options.recipient) throw new Error('options.recipient is required')
    const offerName = OfferName.generate(this.type)
    const handshakeName = OfferName.generate(Handshake.type).name
    const capability = await this._genCapability(
      offerName,
      {
        identityProvider: this._orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey,
        aesKey: options.aesKey,
        [Handshake.type]: {
          name: handshakeName,
          identityProvider: this._orbitdbC._orbitdb.identity._provider,
          idKey: options[Handshake.type].idKey,
          curve: options[Handshake.type].curve
        }
      }
    )
    const offer = await this._createOffer(
      offerName,
      {
        [Handshake.type]: {
          name: handshakeName,
          sender: capability.id,
          recipient: options.recipient,
          curve: capability[Handshake.type].curve
        },
        [SymChannel.type]: {
          name: OfferName.generate(SymChannel.type)
        },
        info: options.info || {}
      }
    )
    return this.open(
      orbitdbC,
      offer,
      capability,
      { log: options.log }
    )
  }

  static async accept (orbitdbC, offer, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!offer) throw new Error('offer must be defined')
    const capability = await this._genCapability(
      offer.name,
      {
        identityProvider: orbitdbC._orbitdb.identity._provider,
        idKey: options.idKey,
        aesKey: options.aesKey,
        [Handshake.type]: {
          name: offer[Handshake.type].name,
          identityProvider: orbitdbC._orbitdb.identity._provider,
          idKey: options[Handshake.type].idKey,
          curve: offer[Handshake.type].meta.curve
        }
      }
    )
    return this.open(orbitdbC, offer, capability, { log: options.log })
  }

  // creates an instance from a channel address that accepts contact offers
  static fromAddress (orbitdbC, address, options) {
    if (!options.recipient) throw new Error('options.recipient is required')
    const offerName = OfferName.generate(this.type)
    const offer = {
      name: offerName.name,
      channel: address,
      recipient: options.recipient
    }
    return new Contact(
      orbitdbC,
      null,
      offer,
      null,
      {
        log: options.log,
        [Handshake.type]: options[Handshake.type],
        info: options.info
      }
    )
  }

  async offers () {
    return this._channel.getOffers()
  }

  async acceptOffer (offerName) {
    if (!offerName) throw new Error('offerName must be defined')
    offerName = OfferName.parse(offerName)
    if (!supported[offerName.type]) throw new Error('offer type not supported')
    const offer = await this._channel.getOffer(offerName.name)
    return supported[offerName.type].accept(this._orbitdbC, offer)
  }
}

module.exports = Contact
