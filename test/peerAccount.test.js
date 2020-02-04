
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const PeerAccount = require('../src/peerAccount')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

describe('PeerAccount', function () {
  this.timeout(timeout)

  let ipfs, orbitdb, dbAddr, rawKey, account

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

  it('generates a new account index', async () => {
    const newIndex = await PeerAccount.genAccountIndex(orbitdb)
    const { index, aesKey } = newIndex
    dbAddr = newIndex.dbAddr
    rawKey = newIndex.rawKey
    assert.strictEqual(await index.constructor.keyCheck(dbAddr, aesKey), true)
  })

  it('logs into an account', async () => {
    account = await PeerAccount.login(orbitdb, dbAddr, rawKey)
    await account.initialized
    Object.keys(account._components)
      .map(x => assert.strictEqual(account[x].status, 'READY'))
  })

  it('instance exposes a keyCheck method', async () => {
    const address = dbAddr.toString()
    assert.strictEqual(await account.keyCheck(address, rawKey), true)
    const newIndex = await PeerAccount.genAccountIndex(orbitdb)
    assert.strictEqual(
      await account.keyCheck(newIndex.dbAddr.toString(), rawKey),
      false
    )
    assert.strictEqual(
      await account.keyCheck(address, newIndex.rawKey),
      false
    )
  })
})
