
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const SessionName = require('../src/sessions/sessionName')
const Profile = require('../src/sessions/profile')
const OrbitdbC = require('../src/orbitdbController')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

const connectPeers = async (ipfs1, ipfs2) => {
  const id1 = await ipfs1.id()
  const id2 = await ipfs2.id()
  await ipfs1.swarm.connect(id2.addresses[0])
  await ipfs2.swarm.connect(id1.addresses[0])
}

describe('Profile Session', function () {
  this.timeout(timeout)

  let ipfs1, ipfs2, orbitdbC1, orbitdbC2, profile1, profile2

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
    await connectPeers(ipfs1, ipfs2)
  })

  after(async () => {
    await orbitdbC1._orbitdb.disconnect()
    await ipfs1.stop()
    await orbitdbC2._orbitdb.disconnect()
    await ipfs2.stop()
  })

  it('creates a profile offer and opens the instance', async () => {
    profile1 = await Profile.offer(orbitdbC1)
    await profile1.initialized
    assert.strictEqual(profile1.status, 'READY')
    assert.strictEqual(profile1.isOwner, true)
  })

  it('accepts a profile offer and opens the instance', async () => {
    profile2 = await Profile.accept(orbitdbC2, profile1.offer)
    await profile2.initialized
    assert.strictEqual(profile2.status, 'READY')
    assert.strictEqual(profile2.isOwner, false)
    assert.strictEqual(
      SessionName.parse(profile1.offer.name).id,
      (await profile2.getProfile()).name
    )
    assert.strictEqual(
      profile1._state.address.toString(),
      profile2._state.address.toString()
    )
  })

  it('accepts a profile offer from address', async () => {
    profile2 = await Profile.fromAddress(orbitdbC2, profile1.address)
    await profile2.initialized
    assert.strictEqual(profile2.status, 'READY')
    assert.strictEqual(profile2.isOwner, false)
    assert.strictEqual(
      SessionName.parse(profile1.offer.name).id,
      (await profile2.getProfile()).name
    )
    assert.strictEqual(
      profile1._state.address.toString(),
      profile2._state.address.toString()
    )
  })

  it('sets and gets the profile', async () => {
    const profile = { name: 'profile1', online: true }
    await profile1.setProfile(profile)
    await new Promise(resolve => {
      profile2._state.events.once('replicated', resolve)
    })
    assert.deepStrictEqual(await profile1.getProfile(), profile)
    assert.deepStrictEqual(await profile2.getProfile(), profile)
  })

  it('gets a field of the profile', async () => {
    const profile = { name: 'profile1', online: true }
    assert.strictEqual(await profile1.getField('name'), profile.name)
    assert.strictEqual(await profile1.getField('online'), profile.online)
  })
})
