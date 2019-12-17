
'use strict'
const Component = require('../component')
const Profile = require('../sessions/profile')

const status = {
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../utils').setStatus(status)

class Profiles extends Component {
  constructor (orbitdbC, offer, capability, options) {
    super(orbitdbC, offer, capability, options)
    this.profiles = {}
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      const record = await this._matchRecord('profile')
      if (record && !record.session) {
        throw new Error('no session for default profile')
      }
      const profile = record
        ? await Profile.open(
          this._orbitdbC,
          record.session.offer,
          record.session.capability,
          record.options
        )
        : await Profile.offer(this._orbitdbC)
      this.profiles = { profile }
      setStatus(this, status.READY)
    } catch (e) {
      this.log.error(e)
      setStatus(this, status.FAILED)
      throw new Error(`${Profiles.type} failed initialization`)
    }
  }

  static get type () { return 'profiles' }
}

module.exports = Profiles
