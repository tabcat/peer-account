
'use strict'

class Manifest {
  constructor (index) {
    if (!index) throw new Error('index must be defined')
    this._index = index
    this.open = true
    this.addAddr = this.addAddr.bind(this)
    this.delAddr = this.delAddr.bind(this)
    this._index._docstore.events.on('closed', function () {
      this.open = false
    }.bind(this))
  }

  static get indexKey () { return 'manifest' }

  static async attatch (account) {
    if (!account) throw new Error('account must be defined')
    const manifest = new Manifest(await account.componentIndex(this.indexKey))
    await manifest.addAddr(account._index._docstore.address.toString())
    return manifest
  }

  async exists (address) {
    return this._index.match(address)
  }

  async manifest () {
    if (!this.open) throw new Error('manifest index is closed')
    return this._index.query(() => true)
      .then(docs => docs.map(doc => doc.address))
  }

  async addAddr (address) {
    if (!this.open) throw new Error('manifest index is closed')
    if (!await this.exists(address)) {
      return this._index.put(address, { address })
    }
  }

  async delAddr (address) {
    if (!this.open) throw new Error('manifest index is closed')
    if (await this.exists(address)) {
      return this._index.del(address)
    }
  }
}

module.exports = Manifest
