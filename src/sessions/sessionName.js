
'use strict'
const { randomBytes } = require('@tabcat/peer-account-crypto')

const id = (sessionName) => sessionName.split('-')[1]
const iv = (id) => new Uint8Array(id.split('.'))

class SessionName {
  constructor (offerType, id) {
    this._type = offerType
    this._id = id
  }

  get type () {
    return this._type
  }

  get id () {
    return this._id
  }

  get iv () {
    return iv(this._id)
  }

  get name () {
    return `${this.type}-${this.id}`
  }

  toString () {
    return this.name
  }

  static generate (type) {
    if (!type) throw new Error('offerType is not defined')
    if (typeof type.toString !== 'function') {
      throw new Error('type is not a string')
    }
    if (type.toString().split('-').length > 1) {
      throw new Error(`
        offerType cannot contain a dash '-': ${type}\n
        use an underscore '_'
        `)
    }
    return new SessionName(type, randomBytes(12).join('.'))
  }

  static parse (name) {
    if (!name) throw new Error('name is not defined')
    if (typeof name.toString !== 'function') {
      throw new Error('name is not a string')
    }
    if (!this.isValid(name.toString())) {
      throw new Error('could not parse invalid offer name')
    }
    const [type, id] = name.toString().split('-')
    return new SessionName(type, id)
  }

  static isValid (name) {
    if (!name) throw new Error('name is not defined')
    if (typeof name.toString !== 'function') {
      throw new Error('offer name is not a string')
    }
    const string = name.toString()
    return string.split('-').length === 2 &&
      this.isValidId(id(string))
  }

  static isValidId (id) {
    if (typeof id.toString !== 'function') {
      throw new Error('id is not a string')
    }
    const string = id.toString()
    if (string.split('.').filter(v => v.length > 0).length === 12) {
      try {
        iv(string)
        return true
      } catch (e) { return false }
    } else {
      return false
    }
  }

  static idToIv (id) { return iv(id) }
}

module.exports = SessionName
