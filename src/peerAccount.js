
'use strict'
const OrbitdbController = require('./orbitdbController')
const Index = require('./encryptedIndex')
const Manifest = require('./components/manifest')
const Contacts = require('./components/contacts')
const Profiles = require('./components/profiles')
const EventEmitter = require('events').EventEmitter

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('./utils').setStatus(status)
const setLogOutputs = require('./utils').setLogOutputs

const components = [Manifest, Contacts]

class PeerAccount {
  constructor (orbitdb, accountIndex, options = {}) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    if (!accountIndex) throw new Error('accountIndex must be defined')
    this._accountIndex = accountIndex
    this.root = this._accountIndex._docstore.address.root
    this.options = options
    this._components = components.reduce((a, c) => ({ ...a, [c.type]: c }))

    this.events = new EventEmitter()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, 'account-', null, this.root.slice(-8))

    this._orbitdbC = new OrbitdbController(orbitdb, this.log)

    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      const duplicates =
        new Set(components.map(v => v.type)).size !== components.length
      if (duplicates) throw new Error('duplicate component types')

      await components.reduce(async (a, c) => {
        await a
        const doc = await this._accountIndex.match(c.type)
        const componentOptions = {
          ...(this.options[c.type] || {}),
          log: this.log
        }

        const component = doc
          // open the existing component session
          ? await c.open(
            this._orbitdbC,
            doc.offer,
            doc.capability,
            componentOptions
          ).catch(e => {
            this.log.error(e)
            throw new Error('failed to open existing component session')
          })
          // generate the component session
          : await c.offer(this._orbitdbC, componentOptions)
            .catch(e => {
              this.log.error(e)
              throw new Error('failed to create component session')
            })

        await component.initialized
        if (component.status === 'FAILED') {
          throw new Error(`component ${c.type} failed to attach`)
        }

        if (!doc) await this._accountIndex.set(c.type, component.toJSON())
        this[c.type] = component
        this.log(`attached component ${c.type}`)
      }, Promise.resolve())

      await this[Manifest.type].addAddr(this._accountIndex._docstore.address)
      setStatus(this, status.READY)
      this.log('initialized')
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
    }
  }

  /*
    this will return a unique account index everytime and is used
    when creating a new account.
    the account index is used to store the address of the component state
    to the component type.
    the account index is a wrapped orbitdb docstore.
    the component state address is an orbitdb address.

    orbitdb is an instance of https://github.com/orbitdb/orbit-db
  */
  static async genAccountIndex (orbitdb) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    return Index.generate(
      new OrbitdbController(orbitdb)
    )
      .catch(e => {
        console.error(e)
        throw new Error('failed generating new account index')
      })
  }

  /*
    peerAccount factory method.
    address is the orbitdb address of the account index.
    rawKey is a raw decryption key.
  */
  static async login (orbitdb, address, rawKey, options) {
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
          throw new Error('failed to open account index')
        })

      return new PeerAccount(orbitdb, accountIndex, options)
    } catch (e) {
      console.error(e)
      throw new Error('account login failed')
    }
  }
}

module.exports = PeerAccount
