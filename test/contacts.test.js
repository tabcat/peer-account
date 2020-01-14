
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const PeerAccount = require('../src/peerAccount')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

const connectPeers = async (ipfs1, ipfs2) => {
  const id1 = await ipfs1.id()
  const id2 = await ipfs2.id()
  await ipfs1.swarm.connect(id2.addresses[0])
  await ipfs2.swarm.connect(id1.addresses[0])
}

describe('Contacts Component', function () {
  this.timeout(timeout)

  let ipfs1, ipfs2, orbitdb1, orbitdb2, account1, account2
  let contact1, contact2

  before(async () => {
    rmrf.sync('./ipfs')
    rmrf.sync('./orbitdb')

    const repo1 = 'repo1'
    const repo2 = 'repo2'

    ipfs1 = await new Promise(resolve => {
      const node = Ipfs({ repo: `./ipfs/${repo1}` })
      node.on('ready', () => resolve(node))
    })
    orbitdb1 = await OrbitDB.createInstance(
      ipfs1,
      {
        directory: `./orbitdb/${repo1}`,
        identity: await Identities.createIdentity({
          id: repo1,
          identityKeysPath: `./orbitdb/${repo1}/idKeys`
        })
      }
    )
    ipfs2 = await new Promise(resolve => {
      const node = Ipfs({ repo: `./ipfs/${repo2}` })
      node.on('ready', () => resolve(node))
    })
    orbitdb2 = await OrbitDB.createInstance(
      ipfs2,
      {
        directory: `./orbitdb/${repo2}`,
        identity: await Identities.createIdentity({
          id: repo2,
          identityKeysPath: `./orbitdb/${repo2}/idKeys`
        })
      }
    )
    const index1 = await PeerAccount.genAccountIndex(orbitdb1)
    const index2 = await PeerAccount.genAccountIndex(orbitdb2)
    account1 = await PeerAccount.login(orbitdb1, index1.dbAddr, index1.rawKey)
    account2 = await PeerAccount.login(orbitdb2, index2.dbAddr, index2.rawKey)
    await Promise.all([account1.initialized, account2.initialized])
    await connectPeers(ipfs1, ipfs2)
  })

  after(async () => {
    await account1._orbitdbC._orbitdb.disconnect()
    await ipfs1.stop()
    await account2._orbitdbC._orbitdb.disconnect()
    await ipfs2.stop()
  })

  it('adds a contact from profile address', async () => {
    let contact1Test
    [contact1, contact1Test] = await Promise.all([
      account1.contacts.contactAdd(
        await account2.profiles.myProfile.address()
      ),
      account1.contacts.contactAdd(
        await account2.profiles.myProfile.address()
      )
    ])
    assert.strictEqual(contact1, contact1Test)
    await Promise.all([
      new Promise(resolve => {
        contact1.events.once('status:HANDSHAKE', resolve)
      }),
      new Promise(resolve => {
        account2.inbox.events.on('replicated', resolve)
      })
    ])
  })

  it('opens a contact from session address', async () => {
    account1.contacts._contacts = {}
    let contact1QueueTest
    [contact1, contact1QueueTest] = await Promise.all([
      account1.contacts.contactOpen(contact1.offer.name),
      account1.contacts.contactOpen(contact1.offer.name)
    ])
    assert.strictEqual(contact1, contact1QueueTest)
    await new Promise(resolve => {
      contact1.events.once('status:HANDSHAKE', resolve)
    })
  })

  it('accepts a contact session offer', async () => {
    let contact2QueueTest
    const [offer2] = await account2.inbox.inboxQuery(
      (offer) => offer.name === contact1.offer.name
    )
    ;[contact2, contact2QueueTest] = await Promise.all([
      account2.contacts.contactAccept(offer2),
      account2.contacts.contactAccept(offer2)
    ])
    assert.strictEqual(contact2, contact2QueueTest)
    await Promise.all([contact1.initialized, contact2.initialized])
  })
})
