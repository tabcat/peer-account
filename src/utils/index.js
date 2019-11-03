
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
  if (!log) log = debug('')
  self.log = log.extend(scope)
  self.log.log = console.log.bind(console)
  self.log.error = log.extend(`${scope}:error`)
  self.log.error.log = console.error.bind(console)
  debug.enable(`${scope}:error`)
  if (self.events) {
    self.log = (...p) => {
      self.log(...p)
      self.events.emit('debug', ...p)
    }
    self.log.error = (...p) => {
      self.log(...p)
      self.events.emit('error', ...p)
    }
  }
}

module.exports = {
  setStatus,
  setLogOutputs
}
