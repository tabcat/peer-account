
'use strict'
const EventEmitter = require('events').EventEmitter

const status = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
}
const setStatus = require('./utils').setStatus(status)
const setLogOutputs = require('./utils').setLogOutput

class Manifest {
  constructor (account, index) {
    if (!account) throw new Error('account must be defined')
    if (!index) throw new Error('index must be defined')
    this._account = account
    this._orbitdbC = account._orbitdbC
    this._index = index
    this._index._docstore.events.once('closed', () => {
      setStatus(this, status.CLOSED)
      this.log('orbitdb closed index')
    })
    this.addAddr = this.addAddr.bind(this)
    this.delAddr = this.delAddr.bind(this)
    this.events = new EventEmitter()
    setStatus(this, status.OPEN)
    setLogOutputs(this, this.indexKey, this._account.log)
  }

  static get indexKey () { return 'manifest' }

  static async attatch (account) {
    if (!account) throw new Error('account must be defined')
    const manifest =
      new Manifest(account, await account.componentIndex(this.indexKey))
    manifest.log('instance created')
    await manifest.addAddr(account._index._docstore.address.toString())
    return manifest
  }

  async open () {
    if (this.status === status.CLOSED) {
      this._index = await this._account.componentIndex(Manifest.indexKey)
      this._index._docstore.events.once('closed', () => {
        setStatus(this, status.CLOSED)
        this.log('orbitdb closed index')
      })
      setStatus(this, status.OPEN)
      this.log('opened manifest')
    } else {
      this.log(`manifest is not closed, status: ${this.status}`)
    }
  }

  async exists (address) {
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    if (!this.status === status.CLOSED) {
      this.log.error(`exists(${address}), index is closed`)
      throw new Error('manifest closed')
    }
    return this._index.match(address)
  }

  async manifest () {
    if (!this.status === status.CLOSED) {
      this.log.error('manifest(), index is closed')
      throw new Error('manifest closed')
    }
    const docs = await this._index.query(() => true)
    return docs.map(doc => doc.address)
  }

  async addAddr (address) {
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    if (!this.status === status.CLOSED) {
      this.log.error(`addAddr(${address}), index is closed`)
      throw new Error('manifest closed')
    }
    if (!await this._index.match(address)) {
      await this._index.put(address, { address })
      this.events.emit('add', address)
      this.log(`added ${address}`)
    } else {
      this.log(`address ${address} already added`)
    }
  }

  async delAddr (address) {
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    if (!this.status === status.CLOSED) {
      this.log.error(`delAddr(${address}), index is closed`)
      throw new Error('manifest closed')
    }
    if (await this._index.match(address)) {
      await this._index.del(address)
      this.events.emit('del', address)
      this.log(`deleted ${address}`)
    } else {
      this.log(`address ${address} does not exist to be deleted`)
    }
  }
}

module.exports = Manifest
