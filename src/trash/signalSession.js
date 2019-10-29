
'use strict'
const libsignal = require('@tabcat/signal-protocol')
const SignalStore = require('@tabcat/orbit-db-signal-protocol-store')
const EncryptedDocstore = require('@tabcat/encrypted-docstore')
const util = require('@tabcat/orbit-db-signal-protocol-store/src/helpers')
const EventEmitter = require('events').EventEmitter
const { isDefined } = require('./utils')

const sessionType = 'SignalSession'

class SignalSession {
  constructor(orbitController, config, ) {
    this.type = config.sessionType
    this.orbitC = orbitController
    this.config = config
    this.events = new EventEmitter()
    this.initialized = this.initialize()
  }
  async initialize() {
    if (!isDefined(this.events)) throw new Error('this.events must be defined')
    await this._setUpListeners()

  }
  async _setUpListeners() {
    if (!isDefined(this.orbitC)) throw new Error('this.orbitC must be defined')
    if (!isDefined(this.config)) throw new Error('this.config must be defined')
    const { name,  } = this.config
  }

  // config contains everything for orbit controller to get correct stores
  // includes: sessionType
  static async _createSession(orbitController, config = {}, ) {
    if (!isDefined(orbitController)) throw new Error('orbitController must be defined')
    if (config.sessionType !== sessionType) throw new Error('sessionType did not match')
    if (!config.dbs || !config.dbs.primary || !config.dbs.primary.dbVector) throw new Error('config.dbs.primary.dbVector must be defined')
    const dbVector = config.dbs.primary.dbVector
    const { encVector } = config
    const { rawKey,  } = encVector
    const key = await EncryptedFeed.deriveKey(con)
    const encDbAddr = dbVector.address
      ? dbVector.address
      : encryptedFeed.determineEncDbAddress(orbitController._orbit, dbVector, key, )
    const feed = await orbitController.openDb(dbVector)
    const encryptedFeed = await EncryptedFeed.mount(feed, key, )

  }
  static async _offerSession (orbitController, config, ) {

  }
  static async _joinSession(orbitController, config, ) {

  }

  static async openSignalStore(orbitController, ) {
    const
    const signalStore = new SignalStore(encryptedDocstore)
    return signalStore
  }



}
