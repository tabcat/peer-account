
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const PeerAccount = require('../src/peerAccount')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

describe('Manifest Component', function () {
  this.timeout(timeout)

  let ipfs, orbitdb, index, account

  const address =
    '/orbitdb/zdpuArdUqxC9RdzTyzgBV6CUKbXbKbNVHcSoiyBqS6ZDMaS9B/handshake-126.133.189.153.158.132.78.72.161.158.228.22'
  const nonAddress = 'nonAddress'

  before(async () => {
    rmrf.sync('./ipfs')
    rmrf.sync('./orbitdb')

    const repo = 'repo'

    ipfs = await new Promise(resolve => {
      const node = Ipfs({ repo: `./ipfs/${repo}` })
      node.on('ready', () => resolve(node))
    })
    orbitdb = await OrbitDB.createInstance(
      ipfs,
      {
        directory: `./orbitdb/${repo}`,
        identity: await Identities.createIdentity({
          id: repo,
          identityKeysPath: `./orbitdb/${repo}/idKeys`
        })
      }
    )
    index = await PeerAccount.genAccountIndex(orbitdb)
    account = await PeerAccount.login(orbitdb, index.dbAddr, index.rawKey)
    await account.initialized
    await account.manifest.delAddr(account._index._docstore.address.toString())
    await account.manifest.delAddr(
      account.contacts._index._docstore.address.toString()
    )
    assert.strictEqual(!!account.manifest, true)
  })

  after(async () => {
    await account._orbitdbC._orbitdb.disconnect()
    await ipfs.stop()
  })

  it('adds address to manifest', async () => {
    const worked = await new Promise(resolve => {
      account.manifest.events.once('add', (addr) => {
        resolve(addr === address)
      })
      account.manifest.addAddr(address)
    })
    assert.strictEqual(worked, true)
  })

  it('fails to add non-address to manifest', async () => {
    const worked = await new Promise((resolve, reject) => {
      account.manifest.addAddr(nonAddress)
        .then(() => resolve(true))
        .catch(() => resolve(false))
    })
    assert.strictEqual(worked, false)
  })

  it('deletes address from manifest', async () => {
    const worked = await new Promise(resolve => {
      account.manifest.events.once('del', (addr) => {
        resolve(addr === address)
      })
      account.manifest.delAddr(address)
    })
    assert.strictEqual(worked, true)
  })

  it('fails to delete non-address from manifest', async () => {
    const worked = await new Promise((resolve, reject) => {
      account.manifest.delAddr(nonAddress)
        .then(() => resolve(true))
        .catch(() => resolve(false))
    })
    assert.strictEqual(worked, false)
  })

  it('manifest lists addresses', async () => {
    let manifest = await account.manifest.manifest()
    assert.deepStrictEqual(manifest, [])
    const addresses = [
      address,
      '/orbitdb/zdpuAps3NpUxqMHUGEdbn7GuzQrzH5uXeKSYxAMApDUGXwZuE/iz8AAP4BJ35EFFsadeZYdCpxdH3KgvkVAspzyginoXWH5ekeftK9ZL63F4QJwkpQqU8soag/112.160.62.163.93.221.134.60.160.221.231.227',
      '/orbitdb/zdpuAztAycPb5Np8Uejc7NWxE5UZKmaazcMHHfoVXyQwhPEPJ/zxtrVzdcUxmaR3sVig26wktAyZADvjq9Gg6E6LnzUmRfFYSAm6FE2Cp4Za1S7GPq23CTXcG/144.155.9.167.185.141.252.18.71.157.11.159'
    ]
    await addresses.reduce(
      async (a, c) => [...await a, await account.manifest.addAddr(c)],
      Promise.resolve([])
    )
    manifest = await account.manifest.manifest()
    assert.deepStrictEqual(manifest.sort(), addresses.sort())
  })

  it('says if address exists in manifest', async () => {
    const exists = await account.manifest.exists(address)
    assert.strictEqual(exists, true)
  })

  it('says if address does not exist in manifest', async () => {
    const exists = await account.manifest.exists(
      '/orbitdb/zdpuAyrVKPPJ8WS1GZaKj2qWEX3wKCYBSX6ZW2LPvT8RZxAHG/asym_channel-197.54.82.118.109.240.192.26.31.159.74.188'
    )
    assert.strictEqual(exists, false)
  })

  it('fails to say if non-address exists in manifest', async () => {
    assert.rejects(account.manifest.exists(nonAddress))
  })

  it('reopens manifest', async () => {
    await account.manifest._index._docstore.close()
    assert.strictEqual(account.manifest.status === 'CLOSED', true)
    await account.manifest.open()
    assert.strictEqual(account.manifest.status === 'OPEN', true)
  })
})
