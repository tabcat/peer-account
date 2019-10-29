
'use strict'
const EventEmitter = require('events').EventEmitter
const { isDefined } = require('./utils')

const handlerId = 'SessionHandler'

const statusCodes = ['ERROR', 'INIT', 'CORRESPONDING', 'COMPLETE']

class SessionHandler {
  constructor(sessionsManager, init = null, sesh, direction, status = null, ) {
    if (!isDefined(sessionsManager)) throw new Error('sessionsManager must be defined')
    this._sessionsM = sessionsManager
    if (!isDefined(sesh)) throw new Error('sesh must be defined')
    this.init = init
    this._sesh = sesh
    if (!isDefined(direction)) throw new Error('direction must be defined')
    this.direction = direction
    if (status === null) this.status = { init:init ? direction : 3, sesh:null, }
    this.events = new EventEmitter()
  }

  static handlerId() {
    return handlerId
  }

  static async initiate(sessionsManager) {

    return new SessionsHandler(sessionsManager, initSession, 1, )
  }
  static async join(sessionsManager, initSessionVector, ) {
    const initSession = await sessionsManager.
    return new SessionHandler(sessionsManager, initSession, 2, )
  }

  static async reanimate(sessionsManger, serialized, ) {
    const { init, sesh, direction, status, } = deanimated
    return new SessionHandler(sessionsManager, init, direction, sesh, status, )
  }
  async serialize() {
    const init = this._init.address.toString()
    const sesh = this._shesh ? this._sesh.address.toString() : null
    return { init, sesh, direction:this.direction, status:this.status, }
  }

  async pause() {

  }
  async end() {

  }

  async udpateStatus() {
    this.status =
  }

  async _open() {

  }

}
