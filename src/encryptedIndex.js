
'use strict'
const EncryptedDocstore = require('@tabcat/encrypted-docstore')
const { randomBytes } = require('@tabcat/peer-account-crypto')

class EncryptedIndex extends EncryptedDocstore {
  // get encAddr from this.determineAddress
  static async open (orbitdbC, encAddr, aesKey, dbOptions = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    if (!encAddr) throw new Error('encAddr must be defined')
    if (!aesKey) throw new Error('aesKey must be defined')
    const keyCheck = await this.keyCheck(encAddr, aesKey)
    if (!keyCheck) throw new Error('keyCheck failed')
    const dbVector = { address: encAddr.toString(), options: dbOptions }
    const db = await orbitdbC.openDb(dbVector)
    try {
      return new EncryptedIndex(db, aesKey)
    } catch (e) {
      console.error(e)
      throw new Error('failed to mount EncryptedDocstore')
    }
  }

  static async generate (orbitdbC, options = {}) {
    if (!orbitdbC) throw new Error('orbitdbC must be defined')
    const { length, ...dbOptions } = options
    const orbitdb = orbitdbC._orbitdb
    const aesKey = await this.generateKey(length)
    const rawKey = await this.exportKey(aesKey)
    const dbAddr = await this.determineAddress(
      orbitdb,
      {
        name: dbOptions.name || randomBytes(12).join('.'),
        type: 'docstore',
        options: dbOptions
      },
      aesKey
    )
    const index = await this.open(orbitdbC, dbAddr, aesKey, dbOptions)
    return { index, aesKey, rawKey, address: index._docstore.address }
  }

  async match (key) {
    return (await this.query(doc => doc[this._indexBy] === key))[0]
  }

  async set (key, vals) {
    if (!key) throw new Error('key must be defined')
    if (!vals) throw new Error('vals must be defined')
    if (typeof vals !== 'object') throw new Error('vals must have type object')
    const doc = { [this._indexBy]: key, ...vals }
    return this.put(doc)
  }
}

module.exports = EncryptedIndex
