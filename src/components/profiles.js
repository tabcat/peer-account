
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
      const record = await this._matchRecord('_default')
      if (record && !record.session) {
        throw new Error('no session for default profile')
      }
      const profile = record
        ? await Profile.open(
          this._orbitdbC,
          record.session.offer,
          record.session.capability,
          this.options
        )
        : await Profile.offer(this._orbitdbC, this.options)
      await profile.initialized
      this.profiles = { _default: profile }
      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Profiles.type} failed initialization`)
    }
  }

  static get type () { return 'profiles' }

  get default () {
    return this.profiles[this.profiles._default]
  }

  async setDefault (sessionName) {
    if (!this.profiles[sessionName]) {
      throw new Error('profile session isnt open')
    }
    this.profiles._default = sessionName
  }
}

module.exports = Profiles
