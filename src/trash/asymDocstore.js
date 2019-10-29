
/*
  This class should only be used for setting up secure sessions in orbitdb.
  For encrypted data storage in orbitdb see https://github.com/tabcat/encrypted-docstore
*/
'use strict'

class AsymDocstore {
  constructor(docstore, keystore, ) {
    if (!docstore) throw new Error('docstore must be defined')
    if (!keystore) throw new Error('keystore must be defined')
    this._docstore = docstore
    this.indexBy = this._docstore.options.indexBy
    this._keystore = keystore
  }


  async query(mapper, options = {}) {
    if (mapper === undefined) {
      throw new Error('mapper was undefined')
    }
    const fullOp = options.fullOp || false
    const decryptFullOp = async(entry) => ({
      ...entry,
      payload: {
        ...entry.payload,
        value:await this._key.decryptMsg(entry.payload.value).then(res => res.internal),
      },
    })
    const index = this._docstore._index
    const indexGet = fullOp
      ? async(_id) => decryptFullOp(index._index[_id])
      : async(_id) => index._index[_id]
        ? await this._key.decryptMsg(index._index[_id].payload.value)
          .then(res => res.internal)
        : null
    const indexKeys = Object.keys(index._index)
    return Promise.all(indexKeys.map(key => indexGet(key)))
      .then(arr => arr.filter(mapper))
  }


  async get()

  async create(doc) {
    const asymDoc = {
      [this.indexBy]: await randomBytes(16).then(bytes => bytes.join('')),
      ephKey:
      stage1: doc,
      stage2: null,
    }
    return asymcDoc[this.indexBy]
  }

  async read(id) {

  }

  async update(id, newDoc, ) {
    const oldDoc = await this.read(id)
    if (!oldDoc)
  }

  async delete(id) {

  }

  static async join(orbitdb, ) {

  }

  static async create(docstore, keystore, ) {
    if (!orbitdb) throw new Error('orbitdb must be defined')
    const docstore = await orbitdb.docs(dbAddr, dbOptions, )
    const keystore = await orbitdb.
  }

  static async determineAddress(orbitdb, dbConfig, ecdh, ) {

  }

}
