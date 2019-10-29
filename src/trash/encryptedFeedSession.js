
'use strict'
const libsignal = require('@tabcat/signal-protocol')
const SignalStore = require('@tabcat/orbit-db-signal-protocol-store')
const EncryptedDocstore = require('@tabcat/encrypted-docstore')
const util = require('@tabcat/orbit-db-signal-protocol-store/src/helpers')
const EventEmitter = require('events').EventEmitter
const { isDefined } = require('./utils')

const sessionType = 'EncryptedFeedSession'

class EncryptedFeedSession {
  constructor(orbitController, config, ) {
    this.type = config.sessionType
    this.orbitC = orbitController
    this.config = config
    this.events = new EventEmitter()
    this.initialized = this.initialize()
  }
  async initialize() {
    const primaryDb = await this._openDb()
    primaryDb.events.on('replicated', this._handleDbUpdate('primary'), )
  }

  _onSendMsg(dbname, entryHash, ) {
    this.events.emit('sendMsg', dbName, entryHash, )
  }
  _handleDbUpdate(dbName) {
    const execute = () => {
      this.events.emit('dbUpdate', dbName, )
    }
    return execute
  }

  // config contains everything for orbit controller to get correct stores
  // includes: sessionType
  static async createSession(orbitController, options, ) {
    if (!isDefined(orbitController)) throw new Error('orbitController must be defined')
    const identity = options.identity.publicKey || orbitController.orbit.id.publicKey
    const primaryDbConfig = {
      name:,
      type: 'feed',
      options: {
        accessController: {
          write: [
            '042c07044e7ea51a489c02854db5e09f0191690dc59db0afd95328c9db614a2976e088cab7c86d7e48183191258fc59dc699653508ce25bf0369d67f33d5d77839'
          ]
        }
      }
    }
    return { sessionConfig }
  }
  static async offerSession (orbitController, config, ) {
    if (!isDefined(orbitController)) throw new Error('orbitController must be defined')
    if (config.sessionType !== sessionType) throw new Error('sessionType did not match')

    return sessionOffer
  }
  static async openSession(orbitController, sessionConfig, options, ) {
    if (!isDefined(orbitController)) throw new Error('orbitController must be defined')
    if (sessionConfig.type !== sessionType) throw new Error('sessionType did not match')
    if (sessionConfig.direction !== 2) throw new Error('sessionDirection must be 2')
    return new EncryptedFeedSession(orbitController, config, )
  }

  async pauseSession() {

  }
  async endSession() {}

  static async _openDb(orbitController, config, name = 'primary', ) {
    if (!isDefined(orbitController)) throw new Error('orbitController must be defined')
    if (config.sessionType !== sessionType) throw new Error('sessionType did not match')
    if (!config.dbs || !config.dbs[name] || !config.dbs[name].dbVector)
      throw new Error(`config.dbs.${name}.dbVector must be defined`)
    const dbVector = config.dbs[name].dbVector
    if (!isDefined(config.encVector)) throw new Error('encVector must be defined')
    const key = this._encVector(config.encVector)
    const encDbAddr = dbVector.address
      ? dbVector.address
      : await encryptedFeed.determineEncDbAddress(orbitController._orbit, dbVector, key, )
    const feed = await orbitController._openDb({ address:encDbAddr, options:dbVector.options, })
    const encryptedFeed = await EncryptedFeed.mount(feed, key, )
    return encryptedFeed
  }
  async _openDb(name = 'primary') {
    return await this.constructor._openDb(this.orbitC, this.config, name, )
  }

  static async _encVector({ rawKey, deriver, }) {
    const { bytes, salt, length, purpose, } = deriver
    return rawKey
      ? EncryptedFeed.importKey(rawKey)
      : EncryptedFeed.deriveKey(bytes, salt, length, purpose, )
  }

  async sendMsg(dbName, content, ) {
    if (!isDefined(content)) throw new Error('content must be defined')
    const db = await this._openDb(dbName)
    if (!isDefined(db.add)) throw new Error('db type must be feed')
    const entryHash = await db.add(content)
    this._onSendMsg(dbName, entryHash, )
    return entryHash
  }

  async msgHistory(dbName, options, ) {
    const db = await this._openDb(dbName)
    if (!isDefined(db.iterator)) throw new Error('db type must be feed')
    return await db.iterator(options).collect()
  }

}
