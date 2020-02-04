
'use strict'
const Session = require('./session')
const AsymChannel = require('./asymChannel')
const Handshake = require('./handshake')
const SymChannel = require('./symChannel')
const Message = require('./message')
const SessionId = require('./sessionId')
const Index = require('../encryptedIndex')
const crypto = require('@tabcat/peer-account-crypto')

const statuses = {
  INIT: 'INIT',
  READ_PROFILE: 'READ_PROFILE',
  SEND_OFFER: 'SEND_OFFER',
  CHECK_HANDSHAKE: 'CHECK_HANDSHAKE',
  HANDSHAKE: 'HANDSHAKE',
  READY: 'READY',
  FAILED: 'FAILED'
}

class Contact extends Session {
  constructor (orbitdbC, offer, capability, options = {}) {
    super(orbitdbC, offer, capability, options)
    this._profilesComponent = options.profilesComponent || null
    this.symChannel = null
    this.message = null
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      this.setStatus(statuses.INIT)
      // handles fromAddress creation
      if (this.offer.sessionId && this.offer.profile && !this.offer.meta) {
        this.setStatus(statuses.READ_PROFILE)
        if (!this._profilesComponent) {
          throw new Error(
            'options.profilesComponent must be defined to add from profile'
          )
        }
        const profile = await this._profilesComponent
          .profileOpen(this.offer.profile)
        await profile.initialized
        const asymChannelAddr = await new Promise((resolve, reject) => {
          const poll = async () => {
            const requestField =
              await profile.getField(this.options.field || 'inbox')
            if (requestField !== undefined) validate(requestField)
          }
          const validate = (requestField) => {
            profile._state.events.removeListener('replicated', poll)
            try {
              resolve(this._orbitdbC.parseAddress(requestField))
            } catch (e) {
              this.log.error(
                `failed to get a valid inbox channel address from profile.
                ${requestField}`
              )
              reject(e)
            }
          }
          profile._state.events.on('replicated', poll)
        })
        this._offer = {
          ...this.offer,
          [AsymChannel.type]: asymChannelAddr
        }
      }
      if (this.offer.sessionId && this.offer[AsymChannel.type] && !this.offer.meta) {
        this.setStatus(statuses.SEND_OFFER)
        const asymChannel = await AsymChannel.fromAddress(
          this._orbitdbC,
          this.offer.asym_channel
        )
        await asymChannel.initialized
        if (!asymChannel.isSupported(Contact.type)) {
          throw new Error(`channel does not support ${Contact.type} offers`)
        }
        const { pos } = SessionId.parse(this.offer.sessionId)
        if (await asymChannel.getOffer(pos)) {
          throw new Error(`contact offer ${this.offer.sessionId} already exits`)
        }
        const capability = await Contact.createCapability(
          {
            identityProvider: this._orbitdbC._orbitdb.identity._provider,
            ...this.options,
            sessionId: this.offer.sessionId
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
        this.log.debug(`offer: ${offer.sessionId} sent to asymChannel`)
        this._offer = offer
        this._capability = capability
        this.log.debug('contact offer sent')
      }
      if (
        !await this.constructor.verifyOffer(this.offer) &&
        !await this.constructor.verifyCapability(this.capability)
      ) throw new Error('invalid offer or capability properties')

      this.setStatus(statuses.CHECK_HANDSHAKE)
      const handshake = await Handshake.open(
        this._orbitdbC,
        this.offer[Handshake.type],
        this.capability[Handshake.type],
        { start: false }
      )

      await handshake.initialized

      if (handshake.status !== 'CONFIRMED') {
        this.setStatus(statuses.HANDSHAKE)
        await handshake.start()
        const onHandshakeFail = () => { throw new Error('handshake failed') }
        handshake.events.once('status:FAILED', onHandshakeFail)
        await new Promise((resolve) => {
          handshake.events.once('status:CONFIRMED', () => {
            resolve()
            handshake.events.removeListener('status:FAILED', onHandshakeFail)
          })
        })
        this.log.debug('handshake completed')
      }

      const shake = await handshake.state()
      const aesKey = await crypto.aes.importKey(new Uint8Array(shake.aes))
      const idKey = shake.idKey

      const dbAddr = await Index.determineAddress(
        this._orbitdbC._orbitdb,
        {
          name: this.offer.sessionId,
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
          sessionId: this.offer[SymChannel.type].sessionId,
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

      const messageCapability = await SymChannel.createCapability(
        {
          sessionId: this.offer[Message.type].sessionId,
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

      this.symChannel = { offer: symChannelOffer, capability: symChannelCapability }
      this.message = { offer: messageOffer, capability: messageCapability }

      this.setStatus(statuses.READY)
    } catch (e) {
      this.setStatus(statuses.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
      throw new Error('INIT_FAIL')
    }
  }

  static get type () { return 'contact' }

  static async createOffer (capability, options = {}) {
    if (!await this.verifyCapability(capability)) {
      throw new Error('invalid capability')
    }

    return {
      sessionId: capability.sessionId.toString(),
      sender: options.sender || {},
      recipient: options.recipient || {},
      [Handshake.type]: await Handshake.createOffer(
        capability[Handshake.type],
        options[Handshake.type]
      ),
      [SymChannel.type]: { sessionId: capability[SymChannel.type].sessionId },
      [Message.type]: { sessionId: capability[Message.type].sessionId },
      meta: { sessionType: this.type },
      info: options.info || {}
    }
  }

  static async verifyOffer (offer) {
    if (!offer) throw new Error('offer must be defined')
    if (!offer.sessionId || !SessionId.isValid(offer.sessionId)) return false
    if (SessionId.parse(offer.sessionId).type !== this.type) return false
    if (!offer.sender || !offer.recipient) return false
    if (!offer.meta || !offer.info) return false
    if (
      !offer[Handshake.type] ||
      !await Handshake.verifyOffer(offer[Handshake.type])
    ) return false
    if (!offer[SymChannel.type] || !offer[SymChannel.type].sessionId) return false
    if (!SessionId.isValid(offer[SymChannel.type].sessionId)) return false
    if (!SessionId.isValid(offer[Message.type].sessionId)) return false
    if (
      SessionId.parse(offer[SymChannel.type].sessionId).type !== SymChannel.type
    ) return false
    if (
      SessionId.parse(offer[Message.type].sessionId).type !== Message.type
    ) return false
    return true
  }

  static async createCapability (options = {}) {
    if (!options.identityProvider) {
      throw new Error('options.identityProvider must be defined')
    }
    const fromOffer = options.offer && await this.verifyOffer(options.offer)

    const sessionId = fromOffer
      ? options.offer.sessionId
      : options.sessionId || SessionId.generate(this.type).toString()
    const handshakeOffer = fromOffer
      ? options.offer[Handshake.type]
      : undefined
    const symChannelId = fromOffer
      ? options.offer[SymChannel.type].sessionId
      : options[SymChannel.type] && options[SymChannel.type].sessionId
        ? options[SymChannel.type].sessionId
        : SessionId.generate(SymChannel.type)
    const messageId = fromOffer
      ? options.offer[Message.type].sessionId
      : options[Message.type] && options[Message.type].sessionId
        ? options[Message.type].sessionId
        : SessionId.generate(Message.type)

    const idKey = options.idKey || sessionId.toString()
    const identity = await this._identity(idKey, options.identityProvider)

    return {
      sessionId: sessionId.toString(),
      idKey,
      id: identity.id,
      [Handshake.type]: await Handshake.createCapability(
        {
          identityProvider: options.identityProvider,
          ...(options[Handshake.type] || {}),
          offer: handshakeOffer
        }
      ),
      [SymChannel.type]: { sessionId: symChannelId.toString() },
      [Message.type]: { sessionId: messageId.toString() }
    }
  }

  static async verifyCapability (capability) {
    if (!capability) throw new Error('capability must be defined')
    if (!capability.sessionId || !SessionId.isValid(capability.sessionId)) return false
    if (SessionId.parse(capability.sessionId).type !== this.type) return false
    if (!capability.idKey || !capability.id) return false
    if (!Handshake.verifyCapability(capability[Handshake.type])) return false
    if (
      !capability[SymChannel.type] || !capability[SymChannel.type].sessionId
    ) return false
    if (
      !SessionId.isValid(capability[SymChannel.type].sessionId)
    ) return false
    if (
      SessionId.parse(
        capability[SymChannel.type].sessionId
      ).type !== SymChannel.type
    ) return false
    if (
      !capability[Message.type] || !capability[Message.type].sessionId
    ) return false
    if (!SessionId.isValid(capability[Message.type].sessionId)) return false
    if (
      SessionId.parse(
        capability[Message.type].sessionId
      ).type !== Message.type
    ) return false
    return true
  }
}

module.exports = Contact
