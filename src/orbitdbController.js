
'use strict'
const EventEmitter = require('events').EventEmitter
const setLogOutputs = require('./utils').setLogOutputs

class OrbitdbController {
  constructor (orbitdb, log) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    this._orbitdb = orbitdb
    this.events = new EventEmitter()
    if (log) setLogOutputs(this, 'orbitdbC', log)
    else this.log = () => {}
  }

  static async _dbAddrFromConfig (orbitdb, config) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    if (!config) throw new Error('config must be defined')
    const { name, type, options } = config
    if (!name || !type) {
      throw new Error('name and type must both be defined')
    }
    return orbitdb.determineAddress(name.toString(), type, options)
  }

  static async dbAddr (orbitdb, { name, type, options, address }) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    if (!address && !(name && type)) {
      throw new Error('address or name and type must be defined for dbVector')
    }
    if (name) name = name.toString()
    if (address) address = address.toString()
    return address
      ? this.parseAddress(orbitdb, address)
      : this._dbAddrFromConfig(orbitdb, { name, type, options })
  }

  static async _dbVector (orbitdb, dbVector, load = true) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    if (!dbVector) throw new Error('dbVector must be defined')
    const dbAddr = await this.dbAddr(orbitdb, dbVector)
    if (orbitdb.stores[dbAddr.toString()]) {
      return orbitdb.stores[dbAddr.toString()]
    }
    const db = await orbitdb.open(dbAddr, dbVector.options)
    if (load) await db.load()
    return db
  }

  static isValidAddress (orbitdb, address) {
    return orbitdb.constructor.isValidAddress(address.toString())
  }

  static parseAddress (orbitdb, address) {
    return orbitdb.constructor.parseAddress(address.toString())
  }

  async dbAddr (dbVector) {
    if (!dbVector) throw new Error('dbVector must be defined')
    return OrbitdbController.dbAddr(this._orbitdb, dbVector)
  }

  async _dbVector (dbVector, load = true) {
    if (!dbVector) throw new Error('dbVector must be defined')
    return OrbitdbController._dbVector(this._orbitdb, dbVector, load)
  }

  isValidAddress (address) {
    return OrbitdbController.isValidAddress(this._orbitdb, address)
  }

  parseAddress (address) {
    return OrbitdbController.parseAddress(this._orbitdb, address)
  }

  async openDb (dbVector, load = true) {
    if (!dbVector) throw new Error('dbVector must be defined')
    const dbAddr = await this.dbAddr(dbVector)
    const address = dbAddr.toString()
    if (this._orbitdb.stores[address]) {
      return this._orbitdb.stores[address]
    }
    const db = await this._dbVector(dbVector, load)
    this.events.emit('openDb', address)
    this.log(`opened ${address}`)
    return db
  }

  async closeDb (dbVector) {
    if (!dbVector) throw new Error('dbVector must be defined')
    const db = await this._dbVector(dbVector, false)
    await db.close()
    this.events.emit('closeDb', db.address.toString())
    this.log(`closed ${db.address.toString()}`)
  }

  async dropDb (dbVector) {
    if (!dbVector) throw new Error('dbVector must be defined')
    const db = await this._dbVector(dbVector, false)
    await db.drop()
    this.events.emit('dropDb', db.address.toString())
    this.log(`dropped ${db.address.toString()}`)
  }
}

module.exports = OrbitdbController
