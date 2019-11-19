
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

  let ipfs1, ipfs2, orbitdb1, orbitdb2, index1, index2, account1, account2

  let channel1, contact1, contact2

  const channelName = 'channelName'
  const contactName = 'contactName'

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
    index1 = await PeerAccount.genAccountIndex(orbitdb1)
    index2 = await PeerAccount.genAccountIndex(orbitdb2)
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

  it('creates an asym channel for accepting contact offers', async () => {
    channel1 = await account1.contacts.createChannel({ meta: channelName })
    await new Promise((resolve, reject) => {
      channel1.events.once('status:FAILED', reject)
      channel1.events.once('status:LISTENING', () => {
        channel1.events.removeListener('status:FAILED', reject)
        resolve()
      })
    })
    assert.strictEqual(channel1.status, 'LISTENING')
    assert.strictEqual(
      account1.contacts.channels[channel1.offer.name],
      channel1
    )
    assert.strictEqual(channel1.isSupported('contact'), true)
    assert.strictEqual(
      !!account1.contacts._matchRecord(channel1.offer.name),
      true
    )
  })

  it('sends a contact offer to contact accepting asymChannel', async () => {
    contact2 = await account2.contacts.addContact(
      channel1.address,
      { meta: contactName }
    )
    await new Promise((resolve, reject) => {
      contact2.events.once('status:FAILED', reject)
      contact2.events.once('status:HANDSHAKE', () => {
        contact2.events.removeListener('status:FAILED', reject)
        resolve()
      })
    })
    assert.strictEqual(
      account2.contacts.contacts[contact2.offer.name],
      contact2
    )
    assert.strictEqual(
      !!account2.contacts._matchRecord(contact2.offer.name),
      true
    )
    await new Promise(resolve => {
      channel1._state.events.on('replicated', resolve)
    })
  })

  it('shows contact offer by name', async () => {
    const offer = await account1.contacts.contactOffer(contact2.offer.name)
    assert.notStrictEqual(offer, undefined)
    assert.strictEqual(offer.name, contact2.offer.name)
  })

  it('shows all contact offers', async () => {
    const offers = await account1.contacts.contactOffers()
    assert.strictEqual(offers.length, 1)
    assert.strictEqual(offers[0].name, contact2.offer.name)
  })

  it('accepts a contact offer sent to the asym channel', async () => {
    contact1 = await account1.contacts.acceptOffer(
      contact2.offer.name,
      { meta: contactName }
    )
    await new Promise((resolve, reject) => {
      contact1.events.on('status:FAILED', reject)
      contact1.events.once('status:READY', () => {
        contact1.events.removeListener('status:FAILED', reject)
        resolve()
      })
    })
    assert.strictEqual(
      account1.contacts.contacts[contact1.offer.name],
      contact1
    )
    assert.strictEqual(
      !!account1.contacts._matchRecord(contact1.offer.name),
      true
    )
  })

  it('query contact records', async () => {
    const record = (await account1.contacts.queryContacts(record => {
      return record.meta === contactName
    }))[0]
    assert.notStrictEqual(record, undefined)
    assert.strictEqual(record.name, contact1.offer.name)
    assert.strictEqual(record.meta, contactName)
  })

  it('query asym channel records', async () => {
    const record = (await account1.contacts.queryChannels(record => {
      return record.meta === channelName
    }))[0]
    assert.notStrictEqual(record, undefined)
    assert.strictEqual(record.name, channel1.offer.name)
    assert.strictEqual(record.meta, channelName)
  })

  it('initialization loads stored contacts and asym channels', async () => {
    const contactOffer = contact1.offer
    const channelOffer = channel1.offer
    account1 = await PeerAccount.login(orbitdb1, index1.dbAddr, index1.rawKey)
    await account1.initialized
    assert.strictEqual(!!account1.contacts.contacts[contactOffer.name], true)
    assert.strictEqual(!!account1.contacts.channels[channelOffer.name], true)
    await account1.contacts.contacts[contactOffer.name].initialized
    await account1.contacts.channels[channelOffer.name].initialized
  })
})
