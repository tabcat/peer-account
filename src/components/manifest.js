
'use strict'
const Component = require('./component')

const status = {
  INIT: 'INIT',
  READY: 'READY',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

const manifestClosed = () => new Error('manifest closed')

class Manifest extends Component {
  constructor (account, index, options) {
    super(account, index, options)
    this.addAddr = this.addAddr.bind(this)
    this.delAddr = this.delAddr.bind(this)
    this._index._docstore.events.once('closed', () => {
      setStatus(this, status.CLOSED)
      this.log('orbitdb closed index')
      account._orbitdbC.events.removeListener('openDb', this.addAddr)
      account._orbitdbC.events.removeListener('dropDb', this.delAddr)
    })
    account._orbitdbC.events.on('openDb', this.addAddr)
    account._orbitdbC.events.on('dropDb', this.delAddr)
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      await this.addAddr(this._account._index._docstore.address.toString())
      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
    }
  }

  static get indexKey () { return 'manifest' }

  async exists (address) {
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    if (!this.status === status.CLOSED) {
      this.log.error(`exists(${address}): failed, index is closed`)
      throw manifestClosed()
    }
    return Boolean(await this._index.match(address))
  }

  async manifest () {
    if (this.status === status.CLOSED) {
      this.log.error('manifest(): failed, manifest is closed')
      throw manifestClosed()
    }
    const docs = await this._index.query((doc) => Boolean(doc.address))
    return docs.map(doc => doc.address)
  }

  async addAddr (address) {
    address = address.toString()
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error(`addAddr(${address}): address is invalid`)
    }
    if (address === this._index._docstore.address.toString()) { return }
    if (this.status === status.CLOSED) {
      this.log.error(`addAddr(${address}): failed, manifest is closed`)
      throw manifestClosed()
    }
    if (!await this._index.match(address)) {
      const addition = await this._index.set(address, { address })
      this.events.emit('add', address)
      this.log(`added ${address}`)
      return addition
    } else {
      this.log(`addAddr(${address}): address already exists`)
    }
  }

  async delAddr (address) {
    address = address.toString()
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error(`delAddr(${address}): address is invalid`)
    }
    if (address === this._index._docstore.address.toString()) { return }
    if (this.status === status.CLOSED) {
      this.log.error(`delAddr(${address}): failed, index is closed`)
      throw manifestClosed()
    }
    if (await this._index.match(address)) {
      const deletion = await this._index.del(address)
      this.events.emit('del', address)
      this.log(`deleted ${address}`)
      return deletion
    } else {
      this.log(`delAddr(${address}): address does not exist`)
    }
  }
}

module.exports = Manifest
