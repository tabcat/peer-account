
'use strict'
const Component = require('./component')
const Index = require('../../encryptedIndex')

const status = {
  INIT: 'INIT',
  READY: 'READY',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED'
}
const setStatus = require('../../utils').setStatus(status)

const manifestClosed = () => new Error('manifest closed')

class Manifest extends Component {
  constructor (orbitdbC, offer, capability, options) {
    super(orbitdbC, offer, capability, options)
    this.addAddr = this.addAddr.bind(this)
    this.delAddr = this.delAddr.bind(this)
    this._orbitdbC.events.on('openDb', this.addAddr)
    this._orbitdbC.events.on('dropDb', this.delAddr)
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      const aesKey = await Index.importKey(new Uint8Array(this.offer.aes))
      const dbAddr = await Index.determineAddress(
        this._orbitdbC._orbitdb,
        {
          name: this.offer.name,
          options: {
            ...this.options,
            accessController: {
              write: [this.offer.meta.owner.id]
            },
            meta: this.offer.meta
          }
        },
        aesKey
      )
      this._state = await Index.open(
        this._orbitdbC,
        dbAddr,
        aesKey,
        {
          identity: await this.constructor._identity(
            this.capability.idKey,
            this._orbitdbC._orbitdb.identity._provider
          )
        }
      )
      this._state._docstore.events.once('closed', () => {
        setStatus(this, status.CLOSED)
        this.log('orbitdb closed index')
        this._orbitdbC.events.removeListener('openDb', this.addAddr)
        this._orbitdbC.events.removeListener('dropDb', this.delAddr)
      })
      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Manifest.type} failed initialization`)
    }
  }

  static get type () { return 'manifest' }

  async exists (address) {
    await this.initialized
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    if (!this.status === status.CLOSED) {
      this.log.error(`exists(${address}): failed, index is closed`)
      throw manifestClosed()
    }
    return Boolean(await this._state.match(address))
  }

  async manifest () {
    await this.initialized
    if (this.status === status.CLOSED) {
      this.log.error('manifest(): failed, manifest is closed')
      throw manifestClosed()
    }
    const docs = await this._state.query((doc) => Boolean(doc.address))
    return docs.map(doc => doc.address)
  }

  async addAddr (address) {
    await this.initialized
    address = address.toString()
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error(`addAddr(${address}): address is invalid`)
    }
    if (address === this._state._docstore.address.toString()) { return }
    if (this.status === status.CLOSED) {
      this.log.error(`addAddr(${address}): failed, manifest is closed`)
      throw manifestClosed()
    }
    if (!await this._state.match(address)) {
      const addition = await this._state.set(address, { address })
        .catch(e => {
          this.log.error(e)
          this.log.error(`addAddr(${address}), failed to write to log`)
        })
      this.events.emit('add', address)
      this.log(`added ${address}`)
      return addition
    } else {
      this.log(`addAddr(${address}): address already exists`)
    }
  }

  async delAddr (address) {
    await this.initialized
    address = address.toString()
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error(`delAddr(${address}): address is invalid`)
    }
    if (address === this._state._docstore.address.toString()) { return }
    if (this.status === status.CLOSED) {
      this.log.error(`delAddr(${address}): failed, index is closed`)
      throw manifestClosed()
    }
    if (await this._state.match(address)) {
      const deletion = await this._state.del(address)
        .catch(e => {
          this.log.error(e)
          this.log.error(`addAddr(${address}), failed to write to log`)
        })
      this.events.emit('del', address)
      this.log(`deleted ${address}`)
      return deletion
    } else {
      this.log(`delAddr(${address}): address does not exist`)
    }
  }
}

module.exports = Manifest
