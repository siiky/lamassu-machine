'use strict'
const path = require('path')
const sqlite = require('./sqlite')

const root = path.join(__dirname, "..")
const dataPath = require(path.join(root, "device_config.json")).brain.dataPath

const filename = path.join(root, dataPath, "lssettings.sqlite")
const migrationsPath = path.join(root, "migrations")

const dbPromise = sqlite.openCached(filename)
  .then(db => db.run("PRAGMA journal_mode = WAL")
    .then(_ => db.migrate({ migrationsPath }))
    .then(_ => db)
  )

const { withDB, all, get, run, withTx } = sqlite.helpers(dbPromise)

const getVersions = () => db => db.get("SELECT current, latest FROM versions WHERE rowid = 1")
exports.getVersions = () => withDB(getVersions())
exports.updateVersions = ({ current, latest }) => run(
  "UPDATE versions SET current = ?, latest = ? WHERE rowid = 1",
  current,
  latest
)
exports.updateCurrentVersion = current => run(
  "UPDATE versions SET current = ? WHERE rowid = 1",
  current
)
exports.updateLatestVersion = latest => run(
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

/*
 * Ping URLs
 */

const getURLsToPing = db =>
  db.all("SELECT url FROM urls_to_ping")
    .map(({ url }) => url)
exports.getURLsToPing = () => withDB(getURLsToPing)

const deleteOldURLs = oldURLs => db => db.run(
  "DELETE FROM urls_to_ping WHERE url IN " + sqlite.makeTuple(oldURLs.length),
  oldURLs
)

const insertNewURLs = newURLs => db => db.run(
  "INSERT INTO urls_to_ping (url) VALUES " + sqlite.makeValues(1, newURLs.length),
  newURLs
)

const setDifference = (s1, s2) => s1.filter(x => !s2.includes(x))
exports.updateURLsToPing = newURLs =>
  withTx(db =>
    getURLsToPing(db)
      .then(oldURLs => Promise.all([
        deleteOldURLs(setDifference(oldURLs, newURLs))(db),
        insertNewURLs(setDifference(newURLs, oldURLs))(db),
      ]))
  )
  .then(_ => newURLs)
