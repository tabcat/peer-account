
'use strict'
const OrbitdbController = require('./orbitdbController')
const Index = require('./encryptedIndex')
const Contacts = require('./components/contacts')
const Manifest = require('./components/manifest')
const EventEmitter = require('events').EventEmitter

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}

const setStatus = (self, sc, codes = status) => {
  if (!self.events) throw new Error('no events property')
  if (!codes[sc]) throw new Error('invalid status code')
  if (self.status === sc) { return }
  self.status = codes[sc]
  self.events.emit('status', codes[sc])
}

class PeerAccount {
  constructor (orbitdbC, accountIndex, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!accountIndex) throw new Error('accountIndex must be defined')
    this._orbitdbC = orbitdbC
    this._index = accountIndex
    this._components = {
      [Contacts.indexKey]: Contacts,
      [Manifest.indexKey]: Manifest,
      ...(options.components || {})
    }
    this.events = new EventEmitter()
    this.status = status.PRE_INIT
    this.initialized = this.initialize()
  }

  async initialize () {
    try {
      setStatus(this, status.INIT)
      const c = this._components
      await Promise.all([
        Object.keys(c).forEach(async (k) => {
          if (
            typeof c[k].attach === 'function' &&
            typeof c[k].indexKey === 'string' &&
            c[k].indexKey === k
          ) {
            this[k] = await c[k].attach(this)
            if (this[k].events) {
              await new Promise((resolve, reject) => {
                this[k].events.on('READY', resolve)
                this[k].events.on('FAILED', reject)
              })
            }
          }
        })
      ])
      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      console.error(e)
    }
  }

  // create a new accountIndex
  static async genAccountIndex (orbitdb) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    return Index.generate(new OrbitdbController(orbitdb))
  }

  static async login (orbitdb, address, rawKey) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    if (!address) throw new Error('address must be defined')
    if (!rawKey) throw new Error('rawKey must be defined')
    const orbitdbC = new OrbitdbController(orbitdb)
    const dbAddr = await orbitdbC.parseAddress(address)
    const aesKey = await Index.importKey(rawKey)
    if (!await Index.keyCheck(dbAddr, aesKey)) {
      throw new Error(`invalid account address '${address}' or rawKey`)
    }
    try {
      const accountIndex = await Index.open(orbitdbC, dbAddr, aesKey)
      return new PeerAccount(orbitdbC, accountIndex)
    } catch (e) {
      console.error(e)
      throw new Error('account login failed')
    }
  }

  get components () { return Object.keys(this._components) }

  async componentIndex (indexKey, options = {}) {
    indexKey = `component-${indexKey}`
    const doc = await this._index.match(indexKey)
    if (doc) {
      const key = await Index.importKey(new Uint8Array(doc.rawKey))
      const dbAddr = await this._orbitdbC.parseAddress(doc.address)
      return Index.open(this._orbitdbC, dbAddr, key)
    }
    const { index, rawKey } = await Index.generate(this._orbitdbC, options)
    await this._index.set(
      indexKey,
      {
        indexKey,
        address: index._docstore.address.toString(),
        rawKey: [...rawKey]
      }
    )
    return index
  }
}

module.exports = PeerAccount
