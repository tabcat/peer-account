
'use strict'
const Component = require('./component')

const status = {
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class Profile extends Component {
  constructor (account, index, options) {
    super(account, index, options)
    this.profile = null
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      const address = await this._index.match('profile')
      if (!address) {
        this.profile = await this._orbitdbC.openDb({
          name: `profile-${this._account.root}`,
          type: 'keyvalue'
        })
      } else {
        this.profile = await this._orbitdbC.openDb({ address })
      }
      const name = await this.getName()
      if (!name) {
        this.name = await this.setName(this.options.name || this._account.root.slice(-8))
      } else {
        this.name = name
      }
      setStatus(this, status.READY)
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
      throw new Error(`${Profile.indexKey} failed initialization`)
    }
  }

  static get indexKey () { return 'profile' }

  async setName (name) {
    name = name.toString()
    return this.profile.set('name', name)
  }

  async getName () {
    return this.profile.get('name')
  }
}

module.exports = Profile
