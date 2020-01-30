
'use strict'
const { randomBytes } = require('@tabcat/peer-account-crypto')
const bs58 = require('bs58')

const position = (sessionId) => sessionId.split('-')[1]
const iv = (position) => new Uint8Array(bs58.decode(position))

class SessionId {
  constructor (sessionType, position) {
    this._type = sessionType
    this._pos = position
  }

  get type () { return this._type }

  get pos () { return this._position }

  get iv () { return iv(this.pos) }

  toString () { return `${this.type}-${this.pos}` }

  toJSON () { return this.toString() }

  static generate (type) {
    if (!type) throw new Error('type is not defined')
    if (typeof type.toString !== 'function') {
      throw new Error('type is not a string')
    }
    if (type.toString().split('-').length > 1) {
      throw new Error(`
        type cannot contain a dash (-): ${type}
        use an underscore (_)
        `)
    }
    return new SessionId(type, bs58.encode(randomBytes(12)))
  }

  static parse (sessionId) {
    if (!sessionId) throw new Error('sessionId is not defined')
    if (typeof sessionId.toString !== 'function') {
      throw new Error('sessionId is not a string')
    }
    if (!this.isValid(sessionId.toString())) {
      throw new Error('could not parse invalid sessionId')
    }
    const [sessionType, position] = sessionId.toString().split('-')
    return new SessionId(sessionType, position)
  }

  static isValid (sessionId) {
    if (!sessionId) throw new Error('sessionId is not defined')
    if (typeof sessionId.toString !== 'function') {
      throw new Error('sessionId is not a string')
    }
    const string = sessionId.toString()
    return string.split('-').length === 2 &&
      this.isValidPosition(position(string))
  }

  static isValidPos (pos) {
    if (typeof pos.toString !== 'function') {
      throw new Error('pos is not a string')
    }
    const string = pos.toString()
    if (string.split('.').filter(v => v.length > 0).length === 12) {
      try {
        iv(string)
        return true
      } catch (e) { return false }
    } else {
      return false
    }
  }

  static posToIv (pos) { return iv(pos) }
}

module.exports = SessionId
