
'use strict'
const debug = require('debug')

const setStatus = (codes) => {
  return function (self, sc) {
    if (!self.events) throw new Error('no events property')
    if (!codes[sc]) throw new Error('invalid status code')
    if (self.status === sc) { return }
    self.status = codes[sc]
    self.events.emit('status', codes[sc])
    self.events.emit(`status:${sc}`)
  }
}

const setLogOutputs = (self, scope, log, id = '') => {
  if (!log) {
    self.log = debug(scope + id)
    debug.enable(`${scope}*`)
  } else {
    self.log = log.extend(scope + id)
  }
  self.log.error = self.log.extend('error')
  if (self.events) {
    self.log.log = (...p) => {
      try {
        self.events.emit('debug', ...p)
      } catch (e) { console.error(e) }
    }

    self.log.error.log = (...p) => {
      try {
        self.events.emit('error', ...p)
      } catch (e) { console.error(e) }
    }
    // self.events.on('debug', console.log)
    self.events.on('error', console.log)
  }
}

module.exports = {
  setStatus,
  setLogOutputs
}
