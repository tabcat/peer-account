
'use strict'
const EventEmitter = require('events').EventEmitter

const status = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
}
const setStatus = require('../utils').setStatus(status)
const setLogOutputs = require('../utils').setLogOutputs

class Manifest {
  constructor (account, index) {
    if (!account) throw new Error('account must be defined')
    if (!index) throw new Error('index must be defined')
    this._account = account
    this._orbitdbC = account._orbitdbC
    this._index = index
    this.addAddr = this.addAddr.bind(this)
    this.delAddr = this.delAddr.bind(this)
    this.events = new EventEmitter()
    setStatus(this, status.OPEN)
    setLogOutputs(this, Manifest.indexKey, this._account.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this._index._docstore.events.once('closed', () => {
      setStatus(this, status.CLOSED)
      this.log('orbitdb closed index')
    })
    this.log('instance created')
  }

  static get indexKey () { return 'manifest' }

  static async attach (account) {
    if (!account) throw new Error('account must be defined')
    const manifest =
      new Manifest(account, await account.componentIndex(this.indexKey))
    await manifest.addAddr(account._index._docstore.address.toString())
    account[this.indexKey] = manifest
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
      this.log(`tried to open already open manifest, status: ${this.status}`)
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
    return !!await this._index.match(address)
  }

  async manifest () {
    if (this.status === status.CLOSED) {
      this.log.error('manifest(), index is closed')
      throw new Error('manifest closed')
    }
    const docs = await this._index.query((doc) => !!doc.address)
    return docs.map(doc => doc.address)
  }

  async addAddr (address) {
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    address = address.toString()
    if (address === this._index._docstore.address.toString()) { return }
    if (this.status === status.CLOSED) {
      this.log.error(`failed to add ${address} to closed manifest`)
      return
    }
    if (!await this._index.match(address)) {
      const addition = await this._index.set(address, { address })
      this.events.emit('add', address)
      this.log(`added ${address}`)
      return addition
    } else {
      this.log(`address ${address} already added`)
    }
  }

  async delAddr (address) {
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    address = address.toString()
    if (address === this._index._docstore.address.toString()) { return }
    if (this.status === status.CLOSED) {
      this.log.error(`failed to del ${address} from closed manifest`)
      return
    }
    if (await this._index.match(address)) {
      const deletion = await this._index.del(address)
      this.events.emit('del', address)
      this.log(`deleted ${address}`)
      return deletion
    } else {
      this.log(`address ${address} does not exist to be deleted`)
    }
  }
}

module.exports = Manifest
