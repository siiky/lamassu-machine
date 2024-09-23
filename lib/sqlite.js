'use strict'
const path = require('path')
const { open } = require('sqlite')
const sqlite3 = require('sqlite3').cached.Database

exports.open = filename => open({ filename, driver: sqlite3.Database })
exports.openCached = filename => open({ filename, driver: sqlite3.cached.Database })

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
