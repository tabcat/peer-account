
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

const setLogOutputs = (self, scope, log) => {
  if (!log) {
    self.log = debug(scope)
    self.log.error = debug(`${scope}:error`)
  } else {
    self.log = log.extend(scope)
    self.log.error = log.extend(`${scope}:error`)
  }
  if (self.events) {
    self.log.log = (...p) => self.events.emit('debug', ...p)
    self.log.error.log = (...p) => self.events.emit('error', ...p)
  } else {
    self.log.log = (...p) => console.log(...p)
    self.log.error.log = (...p) => console.error(...p)
  }
}

module.exports = {
  setStatus,
  setLogOutputs
}
