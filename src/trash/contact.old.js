
'use strict'
const Index = require('../encryptedIndex')
const Session = require('./session')
const Handshake = require('./handshake')
const SymChannel = require('./symChannel')
const crypto = require('./crypto')
const { ivFromName } = require('../utils')

class Contact extends Session {
  constructor (orbitdbC, db, offer, capability, options) {
    super(db, offer, capability)
    this._orbitdbC = orbitdbC
  }

  static get type () { return 'contact' }

  static async _genCapability (offer, options) {
    const idKey = options.idKey || offer.name
    const { index, rawKey } = await Index.genIndex(
      orbitdbC,
      {
        name: offer.name,
        type: 'docstore',
        options: {
          ...options,
          ...offer.options,
          /*
            contact this._state is not replicated with the node the contact
            session is with, this happens in symChannel.
            this._state is used for tracking status of the
            contact which is a combination of handshake and symChannel.
            this._state specifically tracks the state of the contact, handshake,
            symChannel, and child sessions offered from symChannel.
          */
          accessController: { write: [identity.id] }
        }
      }
    )
    return { idKey, encDbAddr: index.address.toString(), rawKey}
  }

  static async open (orbitdbC, offer, capability, options) {
    await this._verifyOffer(orbitdbC, offer)
    const identity = await this._identity(capability.idKey)
    const { rawKey } = capability
    const key = await crypto.aes.importKey(rawKey)
    const db = await Index.openIndex(orbitdbC, encDbAddr, key, options)
    const encDbAddr = await Index.determineEncDbAddress(
      orbitdbC._orbitdb,
      {
        name: offer.name,
        type: 'docstore',
        options: {
          ...options,
          ...offer.options,
          /*
            contact this._state is not replicated with contact, this happens
            in symChannel. this._state is used for tracking status of the contact
            which is a combination of handshake and symChannel.
            this._state specifically tracks the state of the contact, handshake,
            symChannel, and child sessions offered from symChannel.
          */
          accessController: { write: [identity.id] }
        }
      },
      key
    )
    const db = await Index.openIndex(orbitdbC, encDbAddr, key, options)
    return new Session(orbitdbC, db, offer, capability, options)
  }

  static async _verifyOffer (orbitdbC, offer) {
    if (offer.sessionType !== this.type) throw new Error('invalid sessionType')
  }

  static async offer (orbitdbC, options) {
    const { name } = await this._genOfferName()
    const capability = await this._genCapability(name, options)
    const handshake = await Handshake.offer(
      orbitdbC,
      { recipient: options.recipient }
    )
    const sessionType = this.type
    const offer = {
      sessionType,
      name,
      handshake: handshake.offer,
      options: { meta: { sessionType } }
    }
    return this.open(orbitdbC, offer, capability, options)
  }

  static async accept (orbitdbC, offer, options) {
    const capability = await this._genCapability(offer, options)
    return this.open(orbitdbC, offer, capability, options)
  }

  static async decline (orbitdbC, offer, options) {}
}

module.exports = Contact
