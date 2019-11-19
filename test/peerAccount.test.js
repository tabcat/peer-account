
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const PeerAccount = require('../src/peerAccount')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

describe('PeerAccount', function () {
  this.timeout(timeout)

  let ipfs, orbitdb, dbAddr, rawKey

  before(async () => {
    rmrf.sync('./ipfs')
    rmrf.sync('./orbitdb')
    ipfs = await new Promise(resolve => {
      const node = Ipfs()
      node.on('ready', () => resolve(node))
    })
    orbitdb = await OrbitDB.createInstance(ipfs)
  })

  after(async () => {
    await orbitdb.disconnect()
    await ipfs.stop()
  })

  it('generates a new account index for an account', async () => {
    const newIndex = await PeerAccount.genAccountIndex(orbitdb)
    const { index, aesKey } = newIndex
    dbAddr = newIndex.dbAddr
    rawKey = newIndex.rawKey
    assert.strictEqual(await index.constructor.keyCheck(dbAddr, aesKey), true)
  })

  it('logins into an account', async () => {
    await PeerAccount.login(orbitdb, dbAddr, rawKey)
  })
})
