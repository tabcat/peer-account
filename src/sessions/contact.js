
'use strict'
const Session = require('./session')
const Handshake = require('./handshake')
const SymChannel = require('./symChannel')
const Index = require('../encryptedIndex')
const Buffer = require('safe-buffer').Buffer
const EventEmitter = require('events').EventEmitter
const crypto = require('@tabcat/peer-account-crypto')
const { ivFromName } = require('./utils')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  HANDSHAKE: 'HANDSHAKE',
  READY: 'READY'
}

class Contact extends Session {
  constructor (orbitdbC, db, offer, capability, options = {}) {
    super(db, offer, capability)
    this._orbitdbC = orbitdbC
    this._channel = null
    this.options = options
    this.status = status.PRE_INIT
    this.events = new EventEmitter()
    this.initialized = this.initialize()
  }

  async initialize () {
    try {
      this.status = status.INIT
      const handleStateInit = async (handshake) => {
        const options = this.options
        if (!handshake) {
          handshake = await Handshake.open(
            this._orbitdbC,
            this.offer[Handshake.type],
            this._capability[Handshake.type],
            { ...options, start: false }
          )
          console.log(handshake)
        }
        const shake = await handshake.state()
        if (shake.status === 'CONFIRMED') {
          console.log('handshake is confirmed')
          const identity = await Contact._identity(handshake.offer.name)
          const [sessionKey, channelKey] = await Promise.all(
            [this.offer, this.offer[SymChannel.type]]
              .map(async ({ name, type }) => crypto.aes.deriveKey(
                Buffer.from(shake.aes),
                ivFromName(name),
                '128',
                type
              ))
          )
          const [session, channel] = await Promise.all([
            Index.determineEncDbAddress(
              this._orbitdbC._orbitdb,
              {
                name: this.offer.name,
                type: 'docstore',
                options: {
                  ...options,
                  ...this.offer.options,
                  identity,
                  meta: this.offer.meta,
                  accessController: {
                    write: [shake.sender.id, shake.recipient.id]
                  }
                }
              },
              sessionKey
            ).then(addr => Index.openIndex(this._orbitdbC, addr, sessionKey)),
            SymChannel.open(
              this._orbitdbC,
              await SymChannel._createOffer(
                this.offer[SymChannel.type].name,
                {
                  key: channelKey,
                  sender: shake.sender.id,
                  recipient: shake.recipient.id,
                  supported: []
                }
              ),
              await SymChannel._genCapability(
                this.offer[SymChannel.type].name,
                {
                  idKey: handshake.offer.name
                }
              ),
              options[SymChannel.type]
            )
          ])
          this._state = session
          this._channel = channel
          this.status = status.READY
          console.log(`${this.offer.name} is ready`)
          this.events.emit('ready')
        } else {
          console.log('handshake not confirmed')
          this.status = status.HANDSHAKE
          handshake.start()
          await new Promise((resolve) => {
            handshake.events.once('confirmed', async () => {
              await handleStateInit(handshake)
              resolve()
            })
          })
        }
      }
      await handleStateInit()
    } catch (e) {
      console.error(e)
      this.events.emit('err', new Error('failed to initialize contact'))
    }
  }

  // session type
  static get type () { return 'contact' }

  /* persistence methods */

  static async _createOffer (offerName, options = {}) {
    if (
      !options.sender || !options.recipient || !options.curve ||
      !options[Handshake.type] || !options[SymChannel.type]
    ) {
      throw new Error('missing required option fields to create offer')
    }
    return {
      type: this.type,
      name: offerName,
      [Handshake.type]: await Handshake._createOffer(
        options[Handshake.type].name,
        {
          sender: options.sender,
          recipient: options.recipient,
          curve: options.curve
        }
      ),
      [SymChannel.type]: {
        name: options[SymChannel.type].name,
        type: SymChannel.type
      },
      meta: { sessionType: this.type }
    }
  }

  static async verifyOffer (orbitdbC, offer, options = {}) {
    if (!orbitdbC || !offer) {
      throw new Error('orbitdbC and offer must be defined')
    }
    if (!offer.type || !offer.name) return false
    if (offer.type !== this.type) return false
    if (!offer[Handshake.type] || !offer[SymChannel.type] || !offer.meta) {
      return false
    }
    return true
  }

  static async _genCapability (offerName, options = {}) {
    const idKey = options.idKey || offerName
    const identity = await this._identity(idKey)
    const handshake = await Handshake._genCapability(
      options.handshake.name,
      { curve: options.curve, idKey }
    )
    return { idKey, id: identity.id, [Handshake.type]: handshake }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.idKey || !capability.id || !capability[Handshake.type]) {
      return false
    }
    return true
  }

  /* factory methods */

  static async open (orbitdbC, offer, capability, options = {}) {
    if (!await this.verifyOffer(orbitdbC, offer)) {
      throw new Error('invalid offer')
    }
    if (!await this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }
    return new Contact(orbitdbC, null, offer, capability, options)
  }

  static async offer (orbitdbC, options = {}) {
    if (!options.recipient) throw new Error('options.recipient is required')
    const { name } = await this._genOfferName()
    const handshake = await Handshake._genOfferName()
    const capability = await this._genCapability(
      name,
      { idKey: options.idKey, curve: options.curve, handshake }
    )
    const offer = await this._createOffer(
      name,
      {
        sender: capability.id,
        recipient: options.recipient,
        curve: capability[Handshake.type].curve,
        [Handshake.type]: handshake,
        [SymChannel.type]: {
          name: (await SymChannel._genOfferName()).name,
          type: SymChannel.type
        },
        info: options.info || {}
      }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  static async accept (orbitdbC, offer, options = {}) {
    const capability = await this._genCapability(
      offer.name,
      {
        idKey: options.idKey,
        curve: offer[Handshake.type].meta.curve,
        handshake: offer[Handshake.type]
      }
    )
    return this.open(orbitdbC, offer, capability, options)
  }

  // static async decline (orbitdbC, offer, options) {}
}

module.exports = Contact
