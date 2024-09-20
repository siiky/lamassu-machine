'use strict'
const path = require('path')
const { open } = require('sqlite')
const driver = require('sqlite3').cached.Database

const root = path.join(__dirname, "..")
const dataPath = require(path.join(root, "device_config.json")).brain.dataPath

const filename = path.join(root, dataPath, "db.sqlite")
const migrationsPath = path.join(root, "migrations")

const dbPromise = open({ filename, driver })
  .then(db => db.run("PRAGMA journal_mode = WAL")
    .then(_ => db.migrate({ migrationsPath }))
    .then(_ => db)
  )

const withDB = proc => dbPromise.then(proc)
const all = (...args) => withDB(db => db.all(...args))
const get = (...args) => withDB(db => db.get(...args))
const run = (...args) => withDB(db => db.run(...args))

const withTx = proc => withDB(db => new Promise((resolve, reject) =>
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

const getVersions = () => db => db.get("SELECT current, latest FROM versions WHERE rowid = 1")
exports.getVersions = () => withDB(getVersions())
exports.updateVersions = ({ current, latest }) => run(
  "UPDATE versions SET current = ?, latest = ? WHERE rowid = 1",
  current,
  latest
)
exports.updateCurrentVersion = (current) => run(
  "UPDATE versions SET current = ? WHERE rowid = 1",
  current
)
exports.updateCurrentVersion = (latest) => run(
  "UPDATE versions SET latest = ? WHERE rowid = 1",
  latest
)


const getLatestNamespaceConfig = namespace => get(
  `SELECT namespace, version, data
  FROM configs
  WHERE namespace = ?
  ORDER BY version DESC
  LIMIT 1`,
  namespace
)

const getNamespaceConfigOn = (namespace, version) => get(
  `SELECT namespace, version, data
  FROM configs
  WHERE namespace = ?
    AND version <= ?
  ORDER BY version DESC
  LIMIT 1`,
  namespace,
  version
)

exports.getNamespaceConfig = (namespace, version) =>
  version ? getNamespaceConfigOn(namespace, version) : getLatestNamespaceConfig(namespace)

exports.insertNamespaceConfig = (namespace, version, data) => run(
  "INSERT INTO configs (namespace, version, data) VALUES (?, ?, ?)",
  namespace, version, data
)



// Alternative query
// SELECT namespace, version, data
// FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY namespace ORDER BY version DESC) AS rn
//       FROM configs)
// WHERE rn = 1;
const getConfigsOn = version => all(
  `SELECT configs.*
  FROM configs,
       (SELECT namespace, MAX(version) AS version
        FROM configs
        WHERE version <= ?
        GROUP BY namespace) AS latest_versions
  WHERE configs.namespace = latest_versions.namespace
    AND configs.version = latest_versions.version`,
  version
)

const getLatestConfigs = () => db => db.all(
  `SELECT configs.*
  FROM configs,
       (SELECT namespace, MAX(version) AS version
        FROM configs
        GROUP BY namespace) AS latest_versions
  WHERE configs.namespace = latest_versions.namespace
    AND configs.version = latest_versions.version`
)

exports.getConfigs = version =>
  version ? getConfigsOn(version) : withDB(getLatestConfigs())

exports.getVersionsAndConfigs = () =>
  withTx(db => Promise.all([
    getLatestConfigs()(db),
    getVersions()(db)
  ]))
  .then(([configs, versions]) => ({ configs, versions }))
