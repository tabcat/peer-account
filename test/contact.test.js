
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const Contact = require('../src/sessions/contact')
const AsymChannel = require('../src/sessions/asymChannel')
const Profile = require('../src/sessions/profile')
const SessionName = require('../src/sessions/sessionName')
const OrbitdbC = require('../src/orbitdbController')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

const connectPeers = async (ipfs1, ipfs2) => {
  const id1 = await ipfs1.id()
  const id2 = await ipfs2.id()
  await ipfs1.swarm.connect(id2.addresses[0])
  await ipfs2.swarm.connect(id1.addresses[0])
}

describe('Contact Session', function () {
  this.timeout(timeout)

  let ipfs1, ipfs2, orbitdbC1, orbitdbC2, contact1, contact2, identity2

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
    identity2 = await Contact._identity(
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

  const checkContacts = (c1, c2) => {
    assert.strictEqual(
      c1._state._docstore.address.toString(),
      c2._state._docstore.address.toString()
    )
    assert.strictEqual(
      c1.channel._state.address.toString(),
      c2.channel._state.address.toString()
    )
    assert.strictEqual(
      c1.message._state.address.toString(),
      c2.message._state.address.toString()
    )
    assert.strictEqual(c1.channel.status, 'LISTENING')
    assert.strictEqual(c2.channel.status, 'LISTENING')
    assert.strictEqual(c1.message.status, 'READY')
    assert.strictEqual(c2.message.status, 'READY')
  }

  it('creates a contact offer and opens the instance', async () => {
    contact1 = await Contact.offer(
      orbitdbC1,
      { handshake: { recipient: identity2.id } }
    )
    await new Promise(resolve => {
      contact1.events.once('status:HANDSHAKE', resolve)
    })
    assert.strictEqual(contact1.status, 'HANDSHAKE')
  })

  it('accepts a contact offer and opens the instance', async () => {
    contact2 = await Contact.accept(
      orbitdbC2,
      contact1.offer,
      { handshake: { idKey: idKey2 } }
    )
    await Promise.all([contact1.initialized, contact2.initialized])
    checkContacts(contact1, contact2)
  })

  it('contact setup from an asymChannel address', async () => {
    const asymChannel1 = await AsymChannel.offer(
      orbitdbC1,
      { supported: [Contact.type] }
    )
    await asymChannel1.initialized
    contact2 = await Contact.fromAsymChannel(
      orbitdbC2,
      await asymChannel1.address()
    )
    await new Promise(resolve => {
      asymChannel1._state.events.once('replicated', resolve)
    })
    const offer = await asymChannel1.getOffer(
      SessionName.parse(contact2.offer.name).id
    )
    contact1 = await Contact.accept(
      orbitdbC1,
      offer,
      { handshake: { idKey: asymChannel1.capability.idKey } }
    )
    await Promise.all([contact1.initialized, contact2.initialized])
    checkContacts(contact1, contact2)
  })

  it('contact setup from a profile address', async () => {
    const profile1 = await Profile.offer(orbitdbC1)
    const profile2 = await Profile.offer(orbitdbC2)
    await Promise.all([profile1.initialized, profile2.initialized])

    const asymChannel1 = await AsymChannel.offer(
      orbitdbC1,
      { supported: [Contact.type] }
    )
    await profile1.setField('inbox', (await asymChannel1.address()).toString())
    // this is not a real profilesComponent, just used for this test
    const profilesComponent = {
      profileOpen: (profileAddress) => Profile.fromAddress(
        orbitdbC2,
        profileAddress
      )
    }
    const contact2 = await Contact.fromProfile(
      orbitdbC2,
      await profile1.address(),
      {
        profilesComponent,
        // sender and recipient fields are optional
        sender: { profile: (await profile2.address()).toString() },
        recipient: { profile: (await profile1.address()).toString() }
      }
    )

    await new Promise(resolve => {
      asymChannel1._state.events.once('replicated', resolve)
    })
    const offer = await asymChannel1.getOffer(
      SessionName.parse(contact2.offer.name).id
    )
    assert.strictEqual(
      (await profile2.address()).toString(),
      offer.sender.profile
    )
    assert.strictEqual(
      (await profile1.address()).toString(),
      offer.recipient.profile
    )
    contact1 = await Contact.accept(
      orbitdbC1,
      offer,
      { handshake: { idKey: asymChannel1.capability.idKey } }
    )
    await Promise.all([contact1.initialized, contact2.initialized])
    checkContacts(contact1, contact2)
  })
})
