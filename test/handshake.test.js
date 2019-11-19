
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const Handshake = require('../src/sessions/handshake')
const OrbitdbC = require('../src/orbitdbController')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

const connectPeers = async (ipfs1, ipfs2) => {
  const id1 = await ipfs1.id()
  const id2 = await ipfs2.id()
  await ipfs1.swarm.connect(id2.addresses[0])
  await ipfs2.swarm.connect(id1.addresses[0])
}

describe('Handshake', function () {
  this.timeout(timeout)

  let ipfs1, ipfs2, orbitdbC1, orbitdbC2, handshake1, handshake2, identity2

  const idKey2 = 'idKey2'

  const repo1 = 'repo1'
  const repo2 = 'repo2'

  before(async () => {
    rmrf.sync('./ipfs')
    rmrf.sync('./orbitdb')
    ipfs1 = await new Promise(resolve => {
      const node = Ipfs({ repo: `./ipfs/${repo1}` })
      node.on('ready', () => resolve(node))
    })
    orbitdbC1 = new OrbitdbC(
      await OrbitDB.createInstance(
        ipfs1,
        {
          directory: `./orbitdb/${repo1}`,
          identity: await Identities.createIdentity({
            id: repo1,
            identityKeysPath: `./orbitdb/${repo1}/idKeys`
          })
        }
      )
    )
    ipfs2 = await new Promise(resolve => {
      const node = Ipfs({ repo: `./ipfs/${repo2}` })
      node.on('ready', () => resolve(node))
    })
    orbitdbC2 = new OrbitdbC(
      await OrbitDB.createInstance(
        ipfs2,
        {
          directory: `./orbitdb/${repo2}`,
          identity: await Identities.createIdentity({
            id: repo2,
            identityKeysPath: `./orbitdb/${repo2}/idKeys`
          })
        }
      )
    )
    identity2 = await Handshake._identity(
      idKey2,
      orbitdbC2._orbitdb.identity._provider
    )
    await connectPeers(ipfs1, ipfs2)
  })

  after(async () => {
    await orbitdbC1._orbitdb.disconnect()
    await ipfs1.stop()
    await orbitdbC2._orbitdb.disconnect()
    await ipfs2.stop()
  })

  it('creates a handshake offer and opens the instance', async () => {
    handshake1 = await Handshake.offer(
      orbitdbC1,
      { recipient: identity2.id }
    )
    await handshake1.initialized
    assert.strictEqual(handshake1.status, 'PRE_CREATION')
    assert.strictEqual(handshake1.direction, 'sender')
  })

  it('accepts a handshake offer and opens the instance', async () => {
    handshake2 = await Handshake.accept(
      orbitdbC2,
      handshake1.offer,
      { idKey: idKey2 }
    )
    await handshake2.initialized
    assert.strictEqual(handshake2.status, 'PRE_CREATION')
    assert.strictEqual(handshake2.direction, 'recipient')
    assert.strictEqual(
      handshake1._state.address.toString(),
      handshake2._state.address.toString()
    )
  })

  it('handshake completes before test timeout', async () => {
    handshake1.start()
    handshake2.start()
    await new Promise(resolve => {
      handshake1.events.once('status:CONFIRMED', resolve)
    })
  })
})
