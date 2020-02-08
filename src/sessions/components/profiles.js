
'use strict'
const SessionManager = require('./sessionManager')
const Profile = require('../profile')
const SessionId = require('../sessionId')

const statuses = {
  PRE_INIT: 'PRE_INIT',
  INIT: 'INIT',
  READY: 'READY',
  FAILED: 'FAILED'
}

class Profiles extends SessionManager {
  constructor (account, offer, capability, options) {
    super(account, offer, capability, { ...options, Session: Profile })
    this._onOpenedSession = this._onOpenedSession.bind(this)
    this.events.on('openedSession', this._onOpenedSession)
    this.initialized = this._initialize()
  }

  static get type () { return 'profiles' }

  async _initialize () {
    try {
      this.setStatus(statuses.INIT)
      await this._attachState()

      const myProfile = 'myProfile'
      if (!await this.existId(myProfile)) {
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

      this.setStatus(statuses.READY)
    } catch (e) {
      this.setStatus(statuses.FAILED)
      this.log.error(e)
      this.log.error('failed initialization')
      throw new Error('INIT_FAIL')
    }
  }

  async profileOpen (profileAddress, options = {}) {
    await this.initialized
    profileAddress = profileAddress.toString()
    if (await this._idsRecorded().then(ids => ids.has(profileAddress))) {
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
        sessionId: dbAddr.path,
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
      const [record] =
        await this._queryRecords(record => record.recordId === recordId)
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
      this.log.debug(`${profile.offer.sessionId} complete record added`)
    })
  }
}

module.exports = Profiles
