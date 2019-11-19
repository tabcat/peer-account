
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const EncryptedIndex = require('../src/encryptedIndex')
const OrbitdbC = require('../src/orbitdbController')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

describe('EncryptedIndex', function () {
  this.timeout(timeout)

  let ipfs, orbitdb, orbitdbC, dbAddr, aesKey

  before(async () => {
    rmrf.sync('./ipfs')
    rmrf.sync('./orbitdb')
    ipfs = await new Promise(resolve => {
      const node = Ipfs()
      node.on('ready', () => resolve(node))
    })
    orbitdb = await OrbitDB.createInstance(ipfs)
    orbitdbC = new OrbitdbC(orbitdb)
  })

  after(async () => {
    await orbitdb.disconnect()
    await ipfs.stop()
  })

  it('generates a new encrypted index', async () => {
    const newIndex = await EncryptedIndex.generate(orbitdbC)
    dbAddr = newIndex.dbAddr
    aesKey = newIndex.aesKey
    assert.strictEqual(await EncryptedIndex.keyCheck(dbAddr, aesKey), true)
  })

  it('opens an encrypted index', async () => {
    const index = await EncryptedIndex.open(orbitdbC, dbAddr, aesKey)
    assert.strictEqual(typeof index.match, 'function')
    assert.strictEqual(typeof index.set, 'function')
  })

  describe('Encrypted Index Methods', function () {
    let index

    beforeEach(async () => {
      index = await EncryptedIndex.open(orbitdbC, dbAddr, aesKey)
    })

    afterEach(async () => {
      await index._docstore.drop()
    })

    it('.match returns an entry with a matching index key', async () => {
      let entries = await index.query(() => true)
      assert.strictEqual(entries.length, 0)

      await index.put({ _id: 'entry0', entry: 0 })
      await index.put({ _id: 'entry1', entry: 1 })
      await index.put({ _id: 'entry2', entry: 2 })
      await index.put({ _id: 'entry3', entry: 3 })

      entries = await index.query(() => true)
      assert.strictEqual(entries.length, 4)
      const doesMatch = await index.match('entry0')
      assert.strictEqual(doesMatch.entry, 0)
      const doesNotMatch = await index.match('entry')
      assert.strictEqual(doesNotMatch, undefined)
    })

    it('.set sets the matching index key to an obj', async () => {
      let entries = await index.query(() => true)
      assert.strictEqual(entries.length, 0)
      await index.set('entry0', { entry: 4 })
      entries = await index.query(() => true)
      assert.strictEqual(entries.length, 1)
      assert.strictEqual(entries[0].entry, 4)
    })
  })
})
