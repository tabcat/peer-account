
'use strict'
const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const Identities = require('orbit-db-identity-provider')
const SessionId = require('../src/sessions/sessionId')
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

const supported = 'supported'

describe('AsymChannel Session', function () {
  this.timeout(timeout)

  let ipfs1, ipfs2, orbitdbC1, orbitdbC2, asymChannel1, asymChannel2

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

  it('creates an asym channel offer and opens the instance', async () => {
    asymChannel1 = await AsymChannel.offer(
      orbitdbC1,
      { supported: [supported] }
    )
    await asymChannel1.initialized
    assert.strictEqual(asymChannel1.status, 'LISTENING')
    assert.strictEqual(asymChannel1.direction, 'recipient')
    assert.strictEqual((await asymChannel1.getOffers()).length, 0)
    assert.deepStrictEqual(asymChannel1.supported, [supported])
    assert.strictEqual(asymChannel1.isSupported(supported), true)
  })

  it('accepts an asym channel offer and opens the instance', async () => {
    asymChannel2 = await AsymChannel.accept(orbitdbC2, asymChannel1.offer)
    await asymChannel2.initialized
    assert.strictEqual(asymChannel2.status, 'LISTENING')
    assert.strictEqual(asymChannel2.direction, 'sender')
    assert.strictEqual((await asymChannel2.getOffers()).length, 0)
    assert.deepStrictEqual(asymChannel2.supported, [supported])
    assert.strictEqual(asymChannel2.isSupported(supported), true)
    assert.strictEqual(
      asymChannel1._state.address.toString(),
      asymChannel2._state.address.toString()
    )
  })

  it('accepts an asym channel offer from address', async () => {
    asymChannel2 = await AsymChannel.fromAddress(
      orbitdbC2,
      await asymChannel1.address()
    )
    await asymChannel2.initialized
    assert.strictEqual(asymChannel2.status, 'LISTENING')
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
    const sessionId = SessionId.generate(unsupported)
    await assert.rejects(asymChannel2.sendOffer({ sessionId }))
    assert.strictEqual(asymChannel2.isSupported(unsupported), false)
    assert.strictEqual((await asymChannel2.getOffers()).length, 0)
  })

  it('rejects owner sending offer', async () => {
    const sessionId = SessionId.generate(supported)
    await assert.rejects(asymChannel1.sendOffer({ sessionId }))
    assert.strictEqual(asymChannel1.isSupported(supported), true)
    assert.strictEqual((await asymChannel2.getOffers()).length, 0)
  })

  it('sends an offer with a supported type', async () => {
    const sessionId = SessionId.generate(supported)
    await asymChannel2.sendOffer({ sessionId: sessionId.toString() })
    await new Promise(resolve => {
      asymChannel1._state.events.once('replicated', resolve)
    })
    assert.strictEqual(asymChannel2.isSupported(supported), true)
    assert.strictEqual((await asymChannel2.getOffers()).length, 1)
    assert.strictEqual((await asymChannel1.getOffers()).length, 1)
    assert.strictEqual(
      !!(await asymChannel2.getOffers())[0]._channel.timestamp,
      true
    )
    assert.strictEqual(
      !!(await asymChannel1.getOffers())[0]._channel.timestamp,
      true
    )
  })

  describe('Offer Getters', function () {
    let validOffer

    const unsupported = 'unsupported'

    before(async () => {
      const entries = await asymChannel2._state.query(() => true)
      assert.strictEqual(entries.length, 1)
      validOffer = await asymChannel2.getOffer(entries[0].sessionPos)
      assert.notStrictEqual(validOffer, undefined)
      assert.strictEqual(
        SessionId.parse(validOffer.sessionId).pos,
        entries[0].sessionPos
      )
      const timestamps = [Date.now(), 0, 2000000000000]
      const customOffers = await Promise.all(
        timestamps.map(async (v, i) => {
          const sessionId =
            SessionId.generate(i === 0 ? unsupported : supported)
          const offer = {
            sessionId: sessionId.toString(),
            _channel: {
              sessionId: asymChannel2.offer.sessionId,
              address: asymChannel2._state.address.toString(),
              timestamp: v
            }
          }
          return {
            [asymChannel2._state.options.indexBy]: sessionId.pos,
            sessionPos: sessionId.pos,
            key: asymChannel2._capability.key,
            cipherbytes: [...(await asymChannel2._encrypt(offer)).cipherbytes]
          }
        })
      )
      await customOffers.reduce(async (a, c) => {
        return [...await a, await asymChannel2._state.put(c)]
      }, Promise.resolve([]))
      await asymChannel2._state.put({ _id: 'invalid' })
      assert.strictEqual(
        (await asymChannel2._state.query(() => true)).length,
        5
      )
    })

    it('get a valid offer by sessionId', async () => {
      assert.deepStrictEqual(
        await asymChannel2.getOffer(SessionId.parse(validOffer.sessionId).pos),
        validOffer
      )
      const entries = await asymChannel2._state.query(() => true)
      const invalidOffers = entries.filter(e =>
        e.sessionPos &&
        e.sessionPos !== SessionId.parse(validOffer.sessionId).pos
      )
      await Promise.all(
        invalidOffers.map(async (v) => {
          if (v.sessionPos) {
            assert.strictEqual(await asymChannel2.getOffer(v.sessionPos), undefined)
          }
        })
      )
    })

    it('get all valid offers', async () => {
      let offers = await asymChannel2.getOffers()
      assert.strictEqual(offers.length, 1)
      assert.deepStrictEqual(offers[0], validOffer)
      const sessionId = SessionId.generate(supported)
      const offer = { sessionId: sessionId.toString() }
      await asymChannel2.sendOffer(offer)
      offers = await asymChannel2.getOffers()
      assert.strictEqual(offers.length, 2)
      assert.strictEqual(
        offers[0].sessionId === validOffer.sessionId ||
        offers[0].sessionId === sessionId.toString(),
        true
      )
      assert.strictEqual(
        offers[1].sessionId === validOffer.sessionId ||
        offers[1].sessionId === sessionId.toString(),
        true
      )
    })
  })
})
