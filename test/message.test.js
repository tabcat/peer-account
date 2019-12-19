
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const Message = require('../src/sessions/message')
const OrbitdbC = require('../src/orbitdbController')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

const connectPeers = async (ipfs1, ipfs2) => {
  const id1 = await ipfs1.id()
  const id2 = await ipfs2.id()
  await ipfs1.swarm.connect(id2.addresses[0])
  await ipfs2.swarm.connect(id1.addresses[0])
}

const supported = 'supported'

describe('Message Session', function () {
  this.timeout(timeout)

  let ipfs1, ipfs2, orbitdbC1, orbitdbC2, message1, message2, identity2

  const idKey2 = 'idKey2'

  before(async () => {
    rmrf.sync('./ipfs')
    rmrf.sync('./orbitdb')

    const repo1 = 'repo1'
    const repo2 = 'repo2'

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
    identity2 = await Message._identity(
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

  it('creates a message offer and opens the instance', async () => {
    message1 = await Message.offer(
      orbitdbC1,
      { supported: [supported], recipient: identity2.id }
    )
    await message1.initialized
    assert.strictEqual(message1.status, 'READY')
  })

  it('accepts an sym channel offer and opens the instance', async () => {
    message2 = await Message.accept(
      orbitdbC2,
      message1.offer,
      { idKey: idKey2 }
    )
    await message2.initialized
    assert.strictEqual(message2.status, 'READY')
    assert.strictEqual(
      message1._state.address.toString(),
      message2._state.address.toString()
    )
  })

  it('sends messages and reads messages', async () => {
    const message = (num) => `message-${num}`
    await message1.sendMessage(message(0))
    await new Promise(resolve => {
      message2._state.events.once('replicated', resolve)
    })
    assert.strictEqual(
      (await message1.readMessages())[0].payload.value.msg,
      message(0)
    )
    assert.strictEqual(
      (await message2.readMessages())[0].payload.value.msg,
      message(0)
    )

    await message2.sendMessage(message(1))
    await new Promise(resolve => {
      message1._state.events.once('replicated', resolve)
    })
    assert.strictEqual(
      (await message1.readMessages({ limit: -1 }))[1].payload.value.msg,
      message(1)
    )
    assert.strictEqual(
      (await message2.readMessages({ limit: -1 }))[1].payload.value.msg,
      message(1)
    )
  })
})
