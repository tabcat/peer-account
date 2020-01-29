
'use strict'
const SessionManager = require('./sessionManager')
const Profile = require('../message')
const SessionId = require('./sessionId')

const status = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}
const setStatus = require('../../utils').setStatus(status)

class Profiles extends SessionManager {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, { ...options, Session: Profile })
    this._onOpenedSession = this.onOpenedSession.bind(this)
    this.events.on('openedSession', this._onOpenedSession)
    this.initialized = this._initialize()
  }

  get type () { return 'profiles' }

  async _initialize () {
    try {
      setStatus(this, status.INIT)
      await this._attachState()

      const myProfile = 'myProfile'
      if (!await this.idExists(myProfile)) {
        this.myProfile = await this.sessionOffer({ recordId: myProfile })
      } else {
        this.myProfile = await this.sessionBy(myProfile)
      }
      await this.myProfile.initialized

      if (this.options.load !== false) {
        this._getRecords(Profile.type)
          .then(records => records.map(
            ({ recordId }) => this.profileOpen(recordId))
          )
      }

      setStatus(this, status.READY)
    } catch (e) {
      setStatus(this, status.FAILED)
      this.log.error(e)
      throw new Error(`${Profiles.type} failed initialization`)
    }
  }

  async profileOpen (profileAddress, options) {
    profileAddress = profileAddress.toString()
    if (this._idsRecorded().then(ids => ids.has(profileAddress))) {
      return this.sessionBy(profileAddress)
    }
    const metadata = { origin: options.origin || profileAddress }
    if (await this.existId(profileAddress)) {
      throw new Error('profile exists')
    }
    options = { ...options, metadata, recordId: profileAddress }
    return this._profileFromAddress(profileAddress, options)
  }

  async _profileFromAddress (address, options) {
    try {
      const dbAddr = this._orbitdbC.parseAddress(address)
      const sessionId = SessionId.parse(dbAddr.path)
      const offer = {
        sessionId: SessionId.generate(this.type),
        [sessionId.type]: dbAddr.toString()
      }
      return this.sessionOpen(offer, null, options)
    } catch (e) {
      console.error(e)
      throw new Error('invalid address')
    }
  }

  async _onOpenedSession (recordId) {
    const profile = await this.sessionBy(recordId)

    profile.events.once('status:READY', async () => {
      const record = await this._matchRecord(recordId)
      if (!record) {
        this.log.error(
          `${profile.offer.sessionId} is ready but record does not exist to update.`
        )
        return
      }
      await this._setRecord(
        profile.offer.sessionId,
        { ...record, session: profile.toJSON() }
      )
      this.log(`${profile.offer.sessionId} complete record added`)
    })
  }
}

module.exports = Profiles
