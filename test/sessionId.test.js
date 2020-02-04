
'use strict'
const assert = require('assert')
const SessionId = require('../src/sessions/sessionId')
const bs58 = require('bs58')

describe('SessionId', function () {
  const validSessionIds = [
    'TYPE-DRf2BQVDMQo9HrXM',
    '_TYPE_-3BeqC1d5xwDW4tbVP',
    'TYPE_TYPE-NXd5qqG9MsNvqXmG'
  ]
  const invalidSessionIds = [
    'invalid',
    'invalid-invalid',
    'invalid-invalid-DRf2BQVDMQo9HrXM',
    'TYPE-DRf2BQVDMQo9HrX0',
    'TYPE-DRf2BQVDMQ9HrXM'
  ]

  it('generates a valid sessionId', () => {
    const type = 'TYPE'
    assert.strictEqual(SessionId.isValid(SessionId.generate(type)), true)
  })

  it('parses valid sessionId string', () => {
    validSessionIds
      .forEach(name => assert.doesNotThrow(() =>
        SessionId.isValid(SessionId.parse(name))
      ))
  })

  it('throws while parsing invalid sessionId strings', () => {
    invalidSessionIds
      .forEach(name => assert.throws(() => SessionId.parse(name)))
  })

  it('validates valid sessionIds', () => {
    validSessionIds
      .forEach(name => assert.strictEqual(SessionId.isValid(name), true))
  })

  it('invalidates invalid sessionIds', () => {
    invalidSessionIds
      .forEach(name => assert.strictEqual(SessionId.isValid(name), false))
  })

  it('converts position to iv', () => {
    const pos = 'DRf2BQVDMQo9HrXM'
    assert.deepStrictEqual(
      SessionId.posToIv(pos),
      Uint8Array.from(bs58.decode(pos))
    )
  })

  describe('SessionId Instance', function () {
    const type = 'TYPE'
    const pos = 'DRf2BQVDMQo9HrXM'
    const sessionId = SessionId.parse(`${type}-${pos}`)

    it('exposes a type getter', () => {
      assert.strictEqual(sessionId.type, type)
    })

    it('exposes a pos getter', () => {
      assert.strictEqual(sessionId.pos, pos)
    })

    it('exposes an iv getter', () => {
      assert.deepStrictEqual(sessionId.iv, Uint8Array.from(bs58.decode(pos)))
    })

    it('exposes a toString method', () => {
      assert.strictEqual(sessionId.toString(), `${type}-${pos}`)
    })

    it('exposes a toJSON method', () => {
      assert.strictEqual(sessionId.toJSON(), `${type}-${pos}`)
    })
  })
})
