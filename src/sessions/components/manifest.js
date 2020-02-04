
'use strict'
const Component = require('./component')

const statuses = {
  INIT: 'INIT',
  READY: 'READY',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED'
}

const manifestClosed = () => new Error('manifest closed')

class Manifest extends Component {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, options)
    this.addAddr = this.addAddr.bind(this)
    this.delAddr = this.delAddr.bind(this)
    this._orbitdbC.events.on('openDb', this.addAddr)
    this._orbitdbC.events.on('dropDb', this.delAddr)
    this.initialized = this._initialize()
  }

  static get type () { return 'manifest' }

  async _initialize () {
    try {
      this.setStatus(statuses.INIT)
      await this._attachState()

      this._state._docstore.events.once('closed', () => {
        this.setStatus(statuses.CLOSED)
        this.log.debug('orbitdb closed index')
        this._orbitdbC.events.removeListener('openDb', this.addAddr)
        this._orbitdbC.events.removeListener('dropDb', this.delAddr)
      })
      this.setStatus(statuses.READY)
    } catch (e) {
      this.setStatus(statuses.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
      throw new Error('INIT_FAIL')
    }
  }

  async exists (address) {
    await this.initialized
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error('address is invalid')
    }
    if (this.status === statuses.CLOSED) {
      this.log.error(`exists(${address}): failed, index is closed`)
      throw manifestClosed()
    }
    return Boolean(await this._state.match(address))
  }

  async manifest () {
    await this.initialized
    if (this.status === statuses.CLOSED) {
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
    if (this.status === statuses.CLOSED) {
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
      this.log.debug(`added ${address}`)
      return addition
    } else {
      this.log.debug(`addAddr(${address}): address already exists`)
    }
  }

  async delAddr (address) {
    await this.initialized
    address = address.toString()
    if (!this._orbitdbC.isValidAddress(address)) {
      throw new Error(`delAddr(${address}): address is invalid`)
    }
    if (address === this._state._docstore.address.toString()) { return }
    if (this.status === statuses.CLOSED) {
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
      this.log.debug(`deleted ${address}`)
      return deletion
    } else {
      this.log.debug(`delAddr(${address}): address does not exist`)
    }
  }
}

module.exports = Manifest
