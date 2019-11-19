
'use strict'

const assert = require('assert')
const Ipfs = require('@tabcat/ipfs-bundle-t')
const OrbitDB = require('orbit-db')
const OrbitdbC = require('../src/orbitdbController')
const rmrf = require('rimraf')
const { timeout } = require('./utils/config')

describe('OrbitdbController', function () {
  this.timeout(timeout)

  let ipfs, orbitdb, db, dbVector, dbAddr

  const config = {
    name: 'test',
    type: 'docstore',
    options: { accessController: { write: ['*'] } }
  }

  const address =
    '/orbitdb/zdpuAsNQ2TorfhoXPYmaAKQj1n36kHSTyRs6cw7AfLyZ2LynC/test'

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

  describe('OrbitdbController Class', function () {
    describe('_dbAddrFromConfig', function () {
      it('gets the dbAddr from a db config', async () => {
        assert.strictEqual(
          (await orbitdb.determineAddress(
            config.name,
            config.type,
            config.options
          )).toString(),
          address
        )
        assert.strictEqual(
          (await OrbitdbC._dbAddrFromConfig(orbitdb, config)).toString(),
          address
        )
      })
    })

    describe('dbAddr', function () {
      it('gets the db addr from a db vector containing a config', async () => {
        dbVector = { ...config }
        dbAddr = await OrbitdbC.dbAddr(orbitdb, dbVector)
        assert.strictEqual(dbAddr.toString(), address)
      })

      it('gets the db addr from a db vector containing an address', async () => {
        dbVector = { address }
        dbAddr = await OrbitdbC.dbAddr(orbitdb, dbVector)
        assert.strictEqual(dbAddr.toString(), address)
      })
    })

    describe('_dbVector', function () {
      afterEach(async () => {
        await db.drop
      })

      it('gets the db from a db vector containing a config', async () => {
        dbVector = { ...config }
        db = await OrbitdbC._dbVector(orbitdb, dbVector)
        assert.strictEqual(db.address.toString(), address)
      })

      it('gets the db from a db vector containing an address', async () => {
        dbVector = { address }
        db = await OrbitdbC._dbVector(orbitdb, dbVector)
        assert.strictEqual(db.address.toString(), address)
      })

      it('loads the db by default', async () => {
        dbVector = { address }
        db = await OrbitdbC._dbVector(orbitdb, dbVector)
        await db.put({ _id: 'entry' })
        await db.close()
        db = await OrbitdbC._dbVector(orbitdb, dbVector)
        assert.strictEqual(db.query(() => true).length, 1)
      })

      it('does not load the db by option', async () => {
        dbVector = { address }
        db = await OrbitdbC._dbVector(orbitdb, dbVector)
        await db.put({ _id: 'entry' })
        await db.close()
        db = await OrbitdbC._dbVector(orbitdb, dbVector, false)
        assert.strictEqual(db.query(() => true).length, 0)
      })
    })

    describe('isValidAddress', function () {
      it('validates an orbitdb address', async () => {
        assert.strictEqual(OrbitdbC.isValidAddress(orbitdb, address), true)
      })

      it('invalidates a non orbitdb address', async () => {
        assert.strictEqual(OrbitdbC.isValidAddress(orbitdb, ''), false)
      })
    })

    describe('parseAddress', function () {
      it('parses an orbitdb address', async () => {
        dbAddr = OrbitDB.parseAddress(address)
        assert.strictEqual(dbAddr.toString(), address)
        dbAddr = OrbitdbC.parseAddress(orbitdb, address)
        assert.strictEqual(dbAddr.toString(), address)
      })
    })
  })

  describe('OrbitdbController Instance', function () {
    let orbitdbC
    before(async () => {
      orbitdbC = new OrbitdbC(orbitdb)
    })

    describe('dbAddr', function () {
      it('gets the db addr from a db vector containing a config', async () => {
        const dbVector = { ...config }
        const dbAddr = await orbitdbC.dbAddr(dbVector)
        assert.strictEqual(dbAddr.toString(), address)
      })

      it('gets the db addr from a db vector containing an address', async () => {
        const dbVector = { address }
        const dbAddr = await orbitdbC.dbAddr(dbVector)
        assert.strictEqual(dbAddr.toString(), address)
      })
    })

    describe('isValidAddress', function () {
      it('validates an orbitdb address', async () => {
        assert.strictEqual(orbitdbC.isValidAddress(address), true)
      })

      it('invalidates a non orbitdb address', async () => {
        assert.strictEqual(orbitdbC.isValidAddress(''), false)
      })
    })

    describe('parseAddress', function () {
      it('parses an orbitdb address', async () => {
        let dbAddr = OrbitDB.parseAddress(address)
        assert.strictEqual(dbAddr.toString(), address)
        dbAddr = orbitdbC.parseAddress(address)
        assert.strictEqual(dbAddr.toString(), address)
      })
    })

    describe('openDb', function () {
      afterEach(async () => {
        await db.drop
      })

      it('gets the db from a db vector containing a config', async () => {
        dbVector = { ...config }
        db = await orbitdbC.openDb(dbVector)
        assert.strictEqual(db.address.toString(), address)
      })

      it('gets the db from a db vector containing an address', async () => {
        dbVector = { address }
        db = await orbitdbC.openDb(dbVector)
        assert.strictEqual(db.address.toString(), address)
      })

      it('loads the db by default', async () => {
        dbVector = { address }
        db = await orbitdbC.openDb(dbVector)
        await db.put({ _id: 'entry' })
        await db.close()
        db = await orbitdbC.openDb(dbVector)
        assert.strictEqual(db.query(() => true).length, 1)
      })

      it('does not load the db by option', async () => {
        dbVector = { address }
        db = await orbitdbC.openDb(dbVector)
        await db.put({ _id: 'entry' })
        await db.close()
        db = await orbitdbC.openDb(dbVector, false)
        assert.strictEqual(db.query(() => true).length, 0)
      })
    })

    describe('closeDb', function () {
      afterEach(async () => {
        await db.drop
      })

      it('closes the db by db vector containing a config', async () => {
        dbVector = { ...config }
        db = await orbitdbC.openDb(dbVector)
        await db.put({ _id: 'entry' })
        await orbitdbC.closeDb(dbVector)
        await assert.rejects(db.put({ _id: 'entry' }))
        db = await orbitdbC.openDb(dbVector)
        assert.strictEqual(db.query(() => true).length, 1)
      })

      it('closes the db by db vector containing an address', async () => {
        dbVector = { address }
        db = await orbitdbC.openDb(dbVector)
        await db.put({ _id: 'entry' })
        await orbitdbC.closeDb(dbVector)
        await assert.rejects(db.put({ _id: 'entry' }))
        db = await orbitdbC.openDb(dbVector)
        assert.strictEqual(db.query(() => true).length, 1)
      })
    })

    describe('dropDb', function () {
      afterEach(async () => {
        await db.drop
      })

      it('drops the db by db vector containing a config', async () => {
        dbVector = { ...config }
        db = await orbitdbC.openDb(dbVector)
        await db.put({ _id: 'entry' })
        await orbitdbC.dropDb(dbVector)
        db = await orbitdbC.openDb(dbVector)
        assert.strictEqual(db.query(() => true).length, 0)
      })

      it('drops the db by db vector containing an address', async () => {
        dbVector = { address }
        db = await orbitdbC.openDb(dbVector)
        await db.put({ _id: 'entry' })
        await orbitdbC.dropDb(dbVector)
        db = await orbitdbC.openDb(dbVector)
        assert.strictEqual(db.query(() => true).length, 0)
      })
    })
  })
})
