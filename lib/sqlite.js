'use strict'
const path = require('path')
const { open } = require('sqlite')
const sqlite3 = require('sqlite3')
if (false) sqlite3.verbose()

const mode = readwrite =>
  readwrite ?
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE :
    sqlite3.OPEN_READONLY // TODO: check if opening fails

const openWithDriver = driver => (filename, readwrite=false) =>
  open({
    filename,
    mode: mode(readwrite),
    driver,
  })

exports.open = openWithDriver(sqlite3.Database)
exports.openCached = openWithDriver(sqlite3.cached.Database)

exports.withDB = db => proc => db.then(proc)

exports.all = withDB => (...args) => withDB(db => db.all(...args))
exports.get = withDB => (...args) => withDB(db => db.get(...args))
exports.run = withDB => (...args) => withDB(db => db.run(...args))

exports.withTx = withDB => proc => withDB(db => new Promise((resolve, reject) =>
  db.getDatabaseInstance().serialize(() =>
    db.run("BEGIN TRANSACTION")
      .then(_ => proc(db))
      .then(ret => db.run("COMMIT TRANSACTION").then(_ => resolve(ret)))
      .catch(err => {
        db.run("ROLLBACK TRANSACTION").then(()=>{},()=>{})
        reject(err)
      })
  )
))

exports.helpers = dbPromise => {
  const withDB = exports.withDB(dbPromise)
  const all = exports.all(withDB)
  const get = exports.get(withDB)
  const run = exports.run(withDB)
  const withTx = exports.withTx(withDB)
  return { withDB, all, get, run, withTx }
}

const repeat = (n, x) => Array(n).fill(x)
exports.makeTuple = n => '(' + repeat(n, '?').join(',') + ')'
exports.makeValues = (nColumns, nRows) => repeat(nRows, exports.makeTuple(nColumns)).join(',')
