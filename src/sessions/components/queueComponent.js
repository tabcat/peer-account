
'use strict'
const Component = require('./component')

class QueueComponent extends Component {
  constructor (...params) {
    super(...params)
    this._queue = null
  }

  _queueAdd (queueKey, key, val) {
    this._queue = {
      ...this._queue,
      [queueKey]: { ...this._queue[queueKey], [key]: val }
    }
  }

  _queueTake (queueKey, key) {
    this._queue = {
      ...this._queue,
      [queueKey]: (
        Object.keys(this._queue[queueKey]).reduce((a, c) =>
          c === key ? a : { ...a, [c]: this._queue[queueKey][c] }
        , {})
      )
    }
  }

  _queueHandler (funcConfig) {
    const { funcKey, params } = funcConfig
    if (!this._queue[funcKey][params[0]]) {
      const promise = this[funcKey](...params)
      this._queueAdd(funcKey, params[0], promise)
    }
    const promise = this._queue[funcKey][params[0]]
    return promise
      .then(() => {
        this._queueTake(funcKey, params[0])
        return promise
      })
      .catch((e) => {
        this.log.error(e)
        this.log.error('_queueHandler failed')
        console.error(funcConfig)
        throw e
      })
  }
}

module.exports = QueueComponent
