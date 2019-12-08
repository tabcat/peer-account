
'use strict'
const EventEmitter = require('events').EventEmitter

const status = { PRE_INIT: 'PRE_INIT' }

const setStatus = require('../utils').setStatus(status)
const setLogOutputs = require('../utils').setLogOutputs

class Component {
  constructor (account, index, options = {}) {
    if (!account) throw new Error('account must be defined')
    if (!index) throw new Error('index must be defined')
    this._account = account
    this._orbitdbC = account._orbitdbC
    this._index = index
    this.options = options
    this.events = new EventEmitter()
    setStatus(this, status.PRE_INIT)
    setLogOutputs(this, this.constructor.indexKey, this._account.log)
    this.events.on('status', status => this.log(`status set to ${status}`))
    this.log('instance created')
  }

  static get indexKey () { return '' }

  static async attach (account, options) {
    if (!account) throw new Error('account must be defined')
    const component =
      new this(account, await account.componentIndex(this.indexKey), options)
    if (component.initialized !== undefined) await component.initialized
    account[this.indexKey] = component
  }
}

module.exports = Component
