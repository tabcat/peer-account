
'use strict'
const EventEmitter = require('events').EventEmitter
const { isDefined, concatStrs } = require('./utils')

const docstore = (index) => index.encrypted
  ? index
  : index.encrypted

const matchKey = async (index, key, val, ) =>
  return await index.query(doc => doc[indexBy(index)] === id.toString())[0]

class Manager {
  constructor(index, prefix, ) {
    if (!isDefined(index)) throw new Error('docstore must be defined')
    this.index = index
    this.indexBy = docstore(this.index).options.indexBy
    if (!isDefined(prefix)) throw new Error('prefix must be defined')
    this.prefix = prefix
    this.events = new EventEmitter()
  }

  _withPrefix(...keys) {
    const seperator = '-'
    return concatStrs(seperator, this.prefix, ...keys, )
  }

  async _setRecord(address, plainObj = {}, ) {
    return await this.index.put({ [this.indexBy]:address.toString(), ...plainObj, })
  }
  async readRecord(address) {
    const record = await matchId(this.index, address.toString(), )
  }
  async _deleteRecord(address) {
    return await this.index.del(address)
  }
  async queryRecords(mapper) {
    return await this.index.query(mapper)
  }

  async _dropIndex() {
    await docstore(this.index).drop()
    return true
  }
  async wipe() {
    this.events.removeAllListeners()
    await await this._dropIndex()
  }

}

module.exports = Manager
