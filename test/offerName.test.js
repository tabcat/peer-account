
'use strict'
const assert = require('assert')
const SessionName = require('../src/sessions/sessionName')

describe('SessionName', function () {
  it('generates a new offer name with specified type', () => {
    const type = 'TYPE'
    assert.strictEqual(SessionName.isValid(SessionName.generate(type)), true)
  })

  it('parses valid offer name strings', () => {
    [
      'TYPE-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_TYPE-245.60.64.252.155.248.180.196.255.251.52.51'
    ].forEach(name => assert.doesNotThrow(
      () => SessionName.isValid(SessionName.parse(name))
    ))
  })

  it('thows while parsing invalid offer name strings', () => {
    [
      // 'invalid',
      // 'invalid-invalid',
      // 'invalid-invalid-245.60.64.252.155.248.180.196.255.251.52.51',
      // 'TYPE-245.60.64.252.155.248.180.196.255.251.52.',
      'TYPE-245.60.64.252.155.248..196.255.251.52.51'
    ].forEach(name => assert.throws(() => SessionName.parse(name)))
  })

  it('validates valid offer name strings', () => {
    [
      'TYPE-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_TYPE-245.60.64.252.155.248.180.196.255.251.52.51'
    ].forEach(name => assert.strictEqual(SessionName.isValid(name), true))
  })

  it('invalidates invalid offer name strings', () => {
    [
      'invalid',
      'invalid-invalid',
      'invalid-invalid-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE-245.60.64.252.155.248.180.196.255.251.52.',
      'TYPE-245.60.64.252.155.248..196.255.251.52.51'
    ].forEach(name => assert.strictEqual(SessionName.isValid(name), false))
  })

  it('converts id to iv', () => {
    const id = '245.60.64.252.155.248.180.196.255.251.52.51'
    assert.deepStrictEqual(SessionName.idToIv(id), new Uint8Array(id.split('.')))
  })

  describe('SessionName Instance', function () {
    let type, id, name, sessionName

    before(() => {
      type = 'TYPE'
      id = '245.60.64.252.155.248.180.196.255.251.52.51'
      name = `${type}-${id}`
      sessionName = SessionName.parse(name)
    })

    it('exposes a type getter', () => {
      assert.strictEqual(sessionName.type, type)
    })

    it('exposes an id getter', () => {
      assert.strictEqual(sessionName.id, id)
    })

    it('exposes an iv getter', () => {
      assert.deepStrictEqual(sessionName.iv, Uint8Array.from(id.split('.')))
    })

    it('exposes a name getter', () => {
      assert.strictEqual(sessionName.name, name)
    })

    it('exposes a toString function', () => {
      assert.strictEqual(sessionName.toString(), name)
    })
  })
})
