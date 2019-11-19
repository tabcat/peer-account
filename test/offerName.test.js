
'use strict'
const assert = require('assert')
const OfferName = require('../src/sessions/offerName')

describe('OfferName', function () {
  it('generates a new offer name with specified type', () => {
    const type = 'TYPE'
    assert.strictEqual(OfferName.isValid(OfferName.generate(type)), true)
  })

  it('parses valid offer name strings', () => {
    [
      'TYPE-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_TYPE-245.60.64.252.155.248.180.196.255.251.52.51'
    ].forEach(name => assert.doesNotThrow(
      () => OfferName.isValid(OfferName.parse(name))
    ))
  })

  it('thows while parsing invalid offer name strings', () => {
    [
      // 'invalid',
      // 'invalid-invalid',
      // 'invalid-invalid-245.60.64.252.155.248.180.196.255.251.52.51',
      // 'TYPE-245.60.64.252.155.248.180.196.255.251.52.',
      'TYPE-245.60.64.252.155.248..196.255.251.52.51'
    ].forEach(name => assert.throws(() => OfferName.parse(name)))
  })

  it('validates valid offer name strings', () => {
    [
      'TYPE-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE_TYPE-245.60.64.252.155.248.180.196.255.251.52.51'
    ].forEach(name => assert.strictEqual(OfferName.isValid(name), true))
  })

  it('invalidates invalid offer name strings', () => {
    [
      'invalid',
      'invalid-invalid',
      'invalid-invalid-245.60.64.252.155.248.180.196.255.251.52.51',
      'TYPE-245.60.64.252.155.248.180.196.255.251.52.',
      'TYPE-245.60.64.252.155.248..196.255.251.52.51'
    ].forEach(name => assert.strictEqual(OfferName.isValid(name), false))
  })

  it('converts id to iv', () => {
    const id = '245.60.64.252.155.248.180.196.255.251.52.51'
    assert.deepStrictEqual(OfferName.idToIv(id), new Uint8Array(id.split('.')))
  })

  describe('OfferName Instance', function () {
    let type, id, name, offerName

    before(() => {
      type = 'TYPE'
      id = '245.60.64.252.155.248.180.196.255.251.52.51'
      name = `${type}-${id}`
      offerName = OfferName.parse(name)
    })

    it('exposes a type getter', () => {
      assert.strictEqual(offerName.type, type)
    })

    it('exposes an id getter', () => {
      assert.strictEqual(offerName.id, id)
    })

    it('exposes an iv getter', () => {
      assert.deepStrictEqual(offerName.iv, Uint8Array.from(id.split('.')))
    })

    it('exposes a name getter', () => {
      assert.strictEqual(offerName.name, name)
    })

    it('exposes a toString function', () => {
      assert.strictEqual(offerName.toString(), name)
    })
  })
})
