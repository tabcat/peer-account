
'use strict'
const QueueComponent = require('./queueComponent')
const Profile = require('../profile')
const SessionName = require('../sessionName')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../../utils').setStatus(status)

class Profiles extends QueueComponent {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, options)
    this._profiles = {}
    this._queue = { _profileOpen: {} }
    this.initialized = this._initialize()
  }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      await this._attachState()

      const myProfile = await this._matchRecord('myProfile')
      if (!myProfile) {
        this.myProfile = await Profile.offer(
          this._orbitdbC,
          { log: this.log }
        )
        const myProfileAddress = (await this.myProfile.address()).toString()
        await this._setRecord(
          'myProfile',
          { address: myProfileAddress }
        )
        await this._setRecord(
          myProfileAddress,
          { address: myProfileAddress }
        )
      } else {
        this.myProfile = await Profile.open(
          this._orbitdbC,
          myProfile.offer,
          myProfile.capability,
          this.options
        )
        await this.myProfile.initialized
      }

      if (this.options.load !== false) {
        this._getRecords(Profile.type)
          .then(docs => docs.map((doc) => this.profileOpen(doc.address)))
      }

      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Profiles.type} failed initialization`)
    }
  }

  static get type () { return 'profiles' }

  profileOpen (profileAddress) {
    const funcKey = '_profileOpen'
    return this._queueHandler({ funcKey, params: [profileAddress] })
  }

  async _profileOpen (profileAddress) {
    if (!profileAddress) throw new Error('sessionName must be defined')
    if (this._profiles[profileAddress]) return this._profiles[profileAddress]

    try {
      const address = this._orbitdbC.parseAddress(profileAddress)
      const { type } = SessionName.parse(address.path)
      if (type !== Profile.type) throw new Error('invalid session name type')
    } catch (e) {
      this.log.error(e)
      throw new Error(`invalid profile address provided: ${profileAddress}`)
    }

    const exists = await this._matchRecord(profileAddress)
    if (!exists) {
      await this._setRecord(
        profileAddress.toString(),
        { address: profileAddress.toString() }
      )
    }

    const profile = await Profile.fromAddress(this._orbitdbC, profileAddress)

    this._profiles = { ...this._profiles, [profileAddress]: profile }
    return this._profiles[profileAddress]
  }
}

module.exports = Profiles
