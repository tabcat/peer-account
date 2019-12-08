
'use strict'
const OrbitdbController = require('./orbitdbController')
const Index = require('./encryptedIndex')
const Manifest = require('./components/manifest')
const Contacts = require('./components/contacts')
const Profile = require('./components/profile')
const EventEmitter = require('events').EventEmitter

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('./utils').setStatus(status)
const setLogOutputs = require('./utils').setLogOutputs

const components = [Manifest, Contacts, Profile]

class PeerAccount {
  constructor (orbitdb, accountIndex, options = {}) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    if (!accountIndex) throw new Error('accountIndex must be defined')
    this._index = accountIndex
    this.root = this._index._docstore.address.root
    this.options = options
    this._components = components.reduce((a, c) => ({ ...a, [c.indexKey]: c }))

    this.events = new EventEmitter()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(
      this,
      'account-',
      null,
      this.root.slice(-8)
    )

    this._orbitdbC = new OrbitdbController(orbitdb, this.log)

    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      await components.reduce(async (a, c) => {
        await a
        await c.attach(this, this.options[c.indexKey])
        this.log(`attached component ${c.indexKey}`)
      }, Promise.resolve())
      setStatus(this, status.READY)
      this.log('initialized')
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
    }
  }

  // create a new accountIndex
  static async genAccountIndex (orbitdb) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    return Index.generate(new OrbitdbController(orbitdb))
      .catch(e => {
        console.error(e)
        throw new Error('failed generating new account index')
      })
  }

  static async login (orbitdb, address, rawKey) {
    try {
      if (!orbitdb) throw new Error('orbitdb must be defined')
      if (!address) throw new Error('address must be defined')
      if (!rawKey) throw new Error('rawKey must be defined')

      const orbitdbC = new OrbitdbController(orbitdb)
      const dbAddr = orbitdbC.parseAddress(address)
      const aesKey = await Index.importKey(rawKey)
        .catch(e => {
          console.error(e)
          throw new Error('failed to import raw key')
        })

      if (!await Index.keyCheck(dbAddr, aesKey)) {
        console.error('key check failed on login')
        throw new Error(`invalid account address '${address}' or rawKey`)
      }
      const accountIndex = await Index.open(orbitdbC, dbAddr, aesKey)
        .catch(e => {
          console.error(e)
          throw new Error('failed to open component index')
        })

      return new PeerAccount(orbitdb, accountIndex)
    } catch (e) {
      console.error(e)
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
          this.log.error(`component ${indexKey} key import failed`)
          throw new Error('failed to import component rawKey')
        })
      this.log(`component ${indexKey} key import successful`)
      if (!this._orbitdbC.parseAddress(doc.address)) {
        this.log.error(`component ${indexKey} has invalid address recorded`)
        throw new Error(`invalid component address: ${doc.address}`)
      }
      const dbAddr = await this._orbitdbC.parseAddress(doc.address)
      return Index.open(this._orbitdbC, dbAddr, key)
        .catch(e => {
          this.log.error(e)
          this.log.error(`failed to mount component ${indexKey} index`)
          throw new Error('failed to open component index')
        })
    }

    const { index, dbAddr, rawKey } =
      await Index.generate(this._orbitdbC, options)
        .catch(e => {
          this.log.error(e)
          this.log.error(`failed to generate index for component ${indexKey}`)
          throw new Error('failed index generation')
        })
    await this._index.set(
      indexKey,
      {
        indexKey,
        address: dbAddr.toString(),
        rawKey: [...rawKey]
      }
    )
    this.log(`added component ${indexKey} record to account index`)
    if (this[Manifest.indexKey]) {
      await this[Manifest.indexKey].addAddr(dbAddr.toString())
      this.log(`added component ${indexKey} index address to manifest`)
    }
    return index
  }
}

module.exports = PeerAccount
