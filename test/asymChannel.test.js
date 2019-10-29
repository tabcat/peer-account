
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const OfferName = require('../src/sessions/offerName')
const AsymChannel = require('../src/sessions/asymChannel')
const OrbitdbC = require('../src/orbitdbController')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

const connectPeers = async (ipfs1, ipfs2) => {
  const id1 = await ipfs1.id()
  const id2 = await ipfs2.id()
  await ipfs1.swarm.connect(id2.addresses[0])
  await ipfs2.swarm.connect(id1.addresses[0])
}

const repo1 = 'repo1'
const repo2 = 'repo2'

const supported = 'supported'

describe('AsymChannel', function () {
  this.timeout(timeout)

  let ipfs1, ipfs2, orbitdbC1, orbitdbC2, asymChannel1, asymChannel2

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
    await connectPeers(ipfs1, ipfs2)
  })

  after(async () => {
    await orbitdbC1._orbitdb.disconnect()
    await ipfs1.stop()
    await orbitdbC2._orbitdb.disconnect()
    await ipfs2.stop()
  })

  it('creates an asym channel offer and opens the instance', async () => {
    asymChannel1 = await AsymChannel.offer(
      orbitdbC1,
      { supported: [supported] }
    )
    await asymChannel1.initialized
    assert.strictEqual(asymChannel1.status, 'READY')
    assert.strictEqual(asymChannel1.direction, 'recipient')
    assert.strictEqual((await asymChannel1.getOffers()).length, 0)
    assert.deepStrictEqual(asymChannel1.supported, [supported])
    assert.strictEqual(asymChannel1.isSupported(supported), true)
  })

  it('accepts an asym channel offer and opens the instance', async () => {
    asymChannel2 = await AsymChannel.accept(orbitdbC2, asymChannel1.offer)
    await asymChannel2.initialized
    assert.strictEqual(asymChannel2.status, 'READY')
    assert.strictEqual(asymChannel2.direction, 'sender')
    assert.strictEqual((await asymChannel2.getOffers()).length, 0)
    assert.deepStrictEqual(asymChannel2.supported, [supported])
    assert.strictEqual(asymChannel2.isSupported(supported), true)
    assert.strictEqual(
      asymChannel1._state.address.toString(),
      asymChannel2._state.address.toString()
    )
  })

  it('rejects sending offer with unsupported type', async () => {
    const unsupported = 'unsupported'
    await assert.rejects(asymChannel2.sendOffer({ type: unsupported }))
    assert.strictEqual(asymChannel2.isSupported(unsupported), false)
    assert.strictEqual((await asymChannel2.getOffers()).length, 0)
  })

  it('rejects owner sending offer', async () => {
    const name = OfferName.generate(supported)
    await assert.rejects(asymChannel1.sendOffer({ type: supported, name }))
    assert.strictEqual(asymChannel1.isSupported(supported), true)
    assert.strictEqual((await asymChannel2.getOffers()).length, 0)
  })

  it('sends an offer with a supported type', async () => {
    const offerName = OfferName.generate(supported)
    await asymChannel2.sendOffer({ type: supported, name: offerName.name })
    await new Promise(resolve => {
      asymChannel1._state.events.on('replicated', resolve)
    })
    assert.strictEqual(asymChannel2.isSupported(supported), true)
    assert.strictEqual((await asymChannel2.getOffers()).length, 1)
    assert.strictEqual((await asymChannel1.getOffers()).length, 1)
    assert.strictEqual(!!(await asymChannel2.getOffers())[0].timestamp, true)
    assert.strictEqual(!!(await asymChannel1.getOffers())[0].timestamp, true)
  })

  describe('Offer Getters', function () {
    let validOffer

    const unsupported = 'unsupported'

    before(async () => {
      const entries = await asymChannel2._state.query(() => true)
      assert.strictEqual(entries.length, 1)
      validOffer = await asymChannel2.getOffer(entries[0].id)
      assert.notStrictEqual(validOffer, undefined)
      assert.strictEqual(
        OfferName.parse(validOffer.name).id,
        entries[0].id
      )
      await Promise.all(
        [Date.now(), 0, 2000000000000].map(async (v, i) => {
          const offerName =
            OfferName.generate(i === 0 ? unsupported : supported)
          const offer = {
            name: offerName.name,
            type: offerName.type
          }
          await asymChannel2._state.put({
            [asymChannel2._state.options.indexBy]: offerName.id,
            id: offerName.id,
            key: asymChannel2._capability.key,
            timestamp: v,
            cipherbytes: [...(await asymChannel2._encrypt(offer)).cipherbytes]
          })
        })
      )
      await asymChannel2._state.put({ _id: 'invalid' })
      assert.strictEqual(
        (await asymChannel2._state.query(() => true)).length,
        5
      )
    })

    it('get a valid offer by name', async () => {
      assert.deepStrictEqual(
        await asymChannel2.getOffer(OfferName.parse(validOffer.name).id),
        validOffer
      )
      const entries = await asymChannel2._state.query(() => true)
      const invalidOffers = entries.filter(e =>
        e.id &&
        e.id !== OfferName.parse(validOffer.name).id
      )
      await Promise.all(
        invalidOffers.map(async (v) => {
          if (v.id) {
            assert.strictEqual(await asymChannel2.getOffer(v.id), undefined)
          }
        })
      )
    })

    it('get all valid offers', async () => {
      let offers = await asymChannel2.getOffers()
      assert.strictEqual(offers.length, 1)
      assert.deepStrictEqual(offers[0], validOffer)
      const offerName = OfferName.generate(supported)
      await asymChannel2.sendOffer({ type: supported, name: offerName.name })
      offers = await asymChannel2.getOffers()
      assert.strictEqual(offers.length, 2)
      assert.strictEqual(
        offers[0].name === validOffer.name || offers[0].name === offerName.name,
        true
      )
      assert.strictEqual(
        offers[1].name === validOffer.name || offers[1].name === offerName.name,
        true
      )
    })
  })
})
