
'use strict'
const OrbitdbController = require('./orbitdbController')
const Index = require('./encryptedIndex')
const Contacts = require('./components/contacts')
const Manifest = require('./components/manifest')
const EventEmitter = require('events').EventEmitter

const statusCodes = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('./utils').setStatus(statusCodes)
const setLogOutputs = require('./utils').setLogOutput

class PeerAccount {
  constructor (orbitdbC, accountIndex, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!accountIndex) throw new Error('accountIndex must be defined')
    this._orbitdbC = orbitdbC
    this._index = accountIndex
    this.options = options
    this._components = {
      [Contacts.indexKey]: Contacts,
      [Manifest.indexKey]: Manifest,
      ...(options.components || {})
    }
    this.events = new EventEmitter()
    setStatus(this, statusCodes.PRE_INIT)
    setLogOutputs(this, `account-${this._index._docstore.address.root}`)
    this.initialized = this._initialize()
    this.log('instance created')
  }

  async _initialize () {
    try {
      setStatus(this, statusCodes.INIT)
      const components = this._components
      await Promise.all([
        Object.keys(components).map(async (k) => {
          if (!components[k].indexKey) {
            this.log.error(`component ${k} does not have indexKey property`)
          }
          if (
            typeof components[k].attach === 'function' &&
            typeof components[k].indexKey === 'string' &&
            components[k].indexKey === k
          ) {
            this[k] = await components[k].attach(this)
            if (!this[k].events) {
              this.log.error(`component ${k} does not have events property`)
              return
            }
            await new Promise((resolve, reject) => {
              this[k].events.once('READY', resolve)
              this[k].events.once('FAILED', reject)
            })
          }
        })
      ])
      setStatus(this, statusCodes.READY)
      this.log('initialized')
    } catch (e) {
      setStatus(this, statusCodes.FAILED)
      this.log.error('failed initialization')
    }
  }

  // create a new accountIndex
  static async genAccountIndex (orbitdb) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    return Index.generate(new OrbitdbController(orbitdb))
      .catch(e => {
        this.log.error(e)
        throw new Error('failed generating new account index')
      })
  }

  static async login (orbitdb, address, rawKey) {
    try {
      if (!orbitdb) throw new Error('orbitdb must be defined')
      if (!address) throw new Error('address must be defined')
      if (!rawKey) throw new Error('rawKey must be defined')

      const orbitdbC = new OrbitdbController(orbitdb)
      if (!orbitdbC.parseAddress(address)) {
        throw new Error('invalid orbitdb address')
      }
      const dbAddr = orbitdbC.parseAddress(address)
      const aesKey = await Index.importKey(rawKey)
        .catch(e => {
          this.log.error(e)
          throw new Error('failed to import raw key')
        })

      if (!await Index.keyCheck(dbAddr, aesKey)) {
        throw new Error(`invalid account address '${address}' or rawKey`)
      }
      const accountIndex = await Index.open(orbitdbC, dbAddr, aesKey)
        .catch(e => {
          this.log.error(e)
          throw new Error('failed to open component index')
        })

      return new PeerAccount(orbitdbC, accountIndex)
    } catch (e) {
      this.log.error(e)
      throw new Error('account login failed')
    }
  }

  get components () { return Object.keys(this._components) }

  async componentIndex (indexKey, options = {}) {
    if (!indexKey) throw new Error('indexKey must be defined')
    indexKey = `component-${indexKey}`
    const doc = await this._index.match(indexKey)

    if (doc) {
      const key = await Index.importKey(new Uint8Array(doc.rawKey))
        .catch(e => {
          this.log.error(e)
          throw new Error('failed to import component rawKey')
        })
      if (!this._orbitdbC.parseAddress(doc.address)) {
        throw new Error(`invalid component address: ${doc.address}`)
      }
      const dbAddr = await this._orbitdbC.parseAddress(doc.address)
      return Index.open(this._orbitdbC, dbAddr, key)
        .catch(e => {
          this.log.error(e)
          throw new Error('failed to open component index')
        })
    }

    const { index, dbAddr, rawKey } =
      await Index.generate(this._orbitdbC, options)
        .catch(e => {
          this.log.error(e)
          throw new Error('failed to generate component index')
        })
    await this._index.set(
      indexKey,
      {
        indexKey,
        address: dbAddr.toString(),
        rawKey: [...rawKey]
      }
    )
    return index
  }
}

module.exports = PeerAccount
