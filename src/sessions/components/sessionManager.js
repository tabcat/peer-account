
'use strict'
const Component = require('./component')

class SessionManager extends Component {
  constructor (p2p, offer, capability, options) {
    super(p2p, offer, capability, options)
    if (!options.Session) throw new Error('options.Session is required')
    this.Session = options.Session
    this._sessions = new Map()
    this._queue = { _sessionOpen: new Map(), _sessionAccept: new Map() }
    this._recordId = new Map()
  }

  get type () { return 'session_manager' }

  _idsQueued () {
    return Object.keys(this._queue).reduce((a, c) =>
      new Set([
        ...a.values(),
        ...this._queue[c].keys()
      ])
    , new Set([...this._recordId.keys()]))
  }

  async _idsRecorded () {
    const records = await this.recordsRead()
    return new Set([
      ...records.map(record => record.sessionId),
      ...records.map(record => record.recordId)
    ])
  }

  async existingIds () {
    return new Set([
      ...this._idsQueued().values(),
      ...(await this._idsRecorded()).values()
    ])
  }

  async existId (recordId) {
    return this.existingIds().then(set => set.has(recordId))
  }

  async recordsRead () {
    return this._getRecords(this.Session.type)
  }

  async recordsQuery (mapper = () => true) {
    return this._queryRecords(record =>
      record.sessionId.startsWith(this.Session.type) && mapper(record)
    ).catch(e => { this.log.error(e); throw e })
  }

  async sessionOffer (options) {
    if (options.sessionId && await this.idExists(options.sessionId)) {
      throw new Error('sessionId already exists')
    }
    if (options.recordId && await this.idExists(options.recordId)) {
      throw new Error('recordId already exists')
    }
    const session = await this.Session.offer(this._orbitdbC, options)
    const recordId = options.recordId || session.offer.sessionId
    return this._openSession(session, recordId, options.metadata)
  }

  async sessionBy (recordId) {
    if (this._sessions.has(recordId)) return this._sessions.get(recordId)
    if (await this._idsRecorded.then(ids => !ids.has(recordId))) {
      throw new Error('no record found for that session')
    }
    const [{ session, options }] =
      await this.recordsQuery(record => record.recordId === recordId)
    return this.sessionOpen(session.offer, session.capability, options)
  }

  sessionOpen (offer, capability, options) {
    const funcKey = '_sessionOpen'
    return this._queueHandler({
      funcKey,
      sessionId: offer.sessionId,
      recordId: options.recordId || offer.sessionId,
      params: [offer, capability, options]
    })
  }

  sessionAccept (offer, options) {
    const funcKey = '_sessionAccept'
    return this._queueHandler({
      funcKey,
      sessionId: offer.sessionId,
      recordId: options.recordId || offer.sessionId,
      params: [offer, options]
    })
  }

  _queueHandler ({ funcKey, sessionId, recordId, params }) {
    if (this._queue[funcKey].has(recordId)) {
      return this._queue[funcKey].get(recordId)
    }
    const promise = this[funcKey](recordId, ...params)
      .catch((e) => {
        this.log.error(e)
        this.log.error('_queueHandler failed')
        console.error({ funcKey, recordId, params })
        throw e
      })
      .finally(() => {
        this._recordId.delete(sessionId)
        this._queue[funcKey].delete(recordId)
      })
    this._recordId.set(sessionId, recordId)
    this._queue[funcKey].set(recordId, promise)
    return promise
  }

  async _openSession (session, recordId, metadata) {
    if (!await this._matchRecord(session.offer.sessionId)) {
      if (await this._idsRecorded.then(ids => !ids.has(recordId))) {
        await this._setRecord(
          session.offer.sessionId,
          {
            recordId,
            sessionId: session.offer.sessionId,
            session: session.toJSON(),
            metadata
          }
        )
        this.events.emit('newSession', recordId)
      } else {
        throw new Error('recordId already exists')
      }
    }
    this._sessions.set(recordId, session)
    this.events.emit('openedSession', recordId)
    return session
  }

  async _sessionOpen (recordId, offer, capability, options) {
    if (this._sessions.has(recordId)) return this._sessions.get(recordId)
    const session =
      await this.Session.open(this._orbitdbC, offer, capability, options)
    return this._openSession(session, recordId, options.metadata)
  }

  async _sessionAccept (recordId, offer, options) {
    if (this._sessions.has(recordId)) return this._sessions.get(recordId)
    const session = await this.Session.accept(this._orbitdbC, offer, options)
    return this._openSession(session, recordId, options.metadata)
  }
}

module.exports = SessionManager
