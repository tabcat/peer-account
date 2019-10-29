
'use strict'
const { isDefined } = require('./utils')

const defaultPrefix = 'SESSIONS_MANAGER'

class SessionsManager {
  constructor(orbitManager, index, prefix = defaultPrefix, ) {
    if (!isDefined(index)) throw new Error('index must be defined')
    super(index, prefix, )
    if (!isDefined(orbitManager)) throw new Error('orbitManager must be defined')
    this._orbitM = orbitManager
    this.sessions = {}
    this.handlers = {}
    this.initialized = this.initialize()
  }
  async initialize() {
    this.events.on('newHandler', this.animate)
  }

  static async managerInstance(orbitManager, prefix, ) {
    if (!isDefined(orbitManager)) throw new Error('orbitManager must be defined')
    prefix = prefix || defaultPrefix
    const vector = { name:prefix, type:'docstore', options:{ replicate:true }, }
    const index = await orbitManager.replicatedDb(vector)
    return new SessionsManager(orbitManager, index, prefix, )
  }

  registerHandler(SessionHandler, reanimate = true, ) {
    await this.initialized
    const handlerId = SessionHandler.handlerId()
    if (this.handlers[handlerId]) {
      this.handlers = { ...this.handlers, [handlerId]:SessionHandler, }
      this.emit('newHandler', handlerId, reanimate, )
    }
  }
  removeHandler(handlerId) {
    delete this.handlers[handlerId]
  }

  async initiateSession(sessionHandler, options, ) {
    await this.initialized
    this.sessions = { ...this.sessions, [address]:sessionInstance, }
    return sessionInstance
  }
  async joinSession(sessionHandler, address, ) {
    await this.initialized
    this.sessions = { ...this.sessions, [address]:sessionInstance, }
    return sessionInstance
  }
  async endSession(address) {
    await this.initialized
    address = address.toString()
    delete this.sessions[address]
    this.events.emit('endSession', address, )

    return await this._deleteRecord(address)
  }

  async reanimateSession(address) {
    await this.initialized
    address = address.toString()
    const record = await this.getRecord(address)

  }
  async dehydrateSession(address) {

  }

  async deleteSession(address) {

  }

  async _sessionDb(dbVector) {
    return await this._orbitM().replicatedDb(dbVector, )
  }

}

module.exports = SessionsManager
