
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
const setStatus = require('./utils').setStatus(status)
const setLogOutputs = require('./utils').setLogOutput

class PeerAccount {
  constructor (orbitdbC, accountIndex, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!accountIndex) throw new Error('accountIndex must be defined')
    this._orbitdbC = orbitdbC
    this._index = accountIndex

    options = { ...options, components: { ...options.components } || {} }
    this.options = options
    options.components = Object.keys(options.components)
      .reduce((a, c) => ({ ...a, [c.indexKey]: c }), {})
    if (
      Object.keys(options.components).length !==
      Object.keys(this.options.components).length
    ) throw new Error('duplicate indexKey properties in optional components')
    this.options.components = options.components
    this._components = {
      [Manifest.indexKey]: Manifest,
      [Contacts.indexKey]: Contacts,
      ...this.options.components
    }

    this.events = new EventEmitter()
    this.initialized = this._initialize()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, `account-${this._index._docstore.address.root}`)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      if (
        this._components[Manifest.indexKey] &&
        this._components[Manifest.indexKey].indexKey === Manifest.indexKey
      ) {
        await this._components[Manifest.indexKey]
          .attatch(this, this.options[Manifest.indexKey])
        this.log(`${Manifest.indexKey} component attached`)
        this._orbitdbC.events.on('openDb', this[Manifest.indexKey].addAddr)
        this._orbitdbC.events.on('dropDb', this[Manifest.indexKey].delAddr)
      }
      if (
        this._components[Contacts.indexKey] &&
        this._components[Contacts.indexKey].indexKey === Contacts.indexKey
      ) {
        await this._components[Contacts.indexKey]
          .attatch(this, this.options[Contacts.indexKey])
        this.log(`${Contacts.indexKey} component attached`)
      }
      await Promise.all([
        Object.keys(this._components)
          .filter((k, i, components) => {
            if (typeof components[k].attach !== 'function') {
              this.log.error(
                `component ${k} has invalid attach property. component will not be attatched`
              )
              return false
            }
            if (
              components[k].indexKey !== Manifest.indexKey &&
              components[k].indexKey !== Contacts.indexKey
            ) return true
          })
          .map(async (k) => {
            await this._components[k].attach(this)
            this.log(`${k} component attached`)
          })
      ])
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
      if (!orbitdbC.parseAddress(address)) {
        throw new Error('invalid orbitdb address')
      }
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

      return new PeerAccount(orbitdbC, accountIndex)
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
