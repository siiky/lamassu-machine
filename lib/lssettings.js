'use strict'
const path = require('path')
const sqlite = require('./sqlite')

const root = path.join(__dirname, "..")
const dataPath = require(path.join(root, "device_config.json")).brain.dataPath

const filename = path.join(root, dataPath, "lssettings.sqlite")
const migrationsPath = path.join(root, "migrations")

const setDifference = (s1, s2) => s1.filter(x => !s2.includes(x))

const dbPromise = sqlite.openCached(filename)
  .then(db => db.run("PRAGMA journal_mode = WAL")
    .then(_ => db.migrate({ migrationsPath }))
    .then(_ => db)
  )

const { withDB, all, get, run, withTx } = sqlite.helpers(dbPromise)

/*
 * Latest configs version
 */

const getVersion = () => db => db.get(
  "SELECT latest FROM version WHERE rowid = 1"
).then(row => row ? row.latest : null)
exports.getVersion = () => withDB(getVersion())
exports.updateVersion = ({ current, latest }) => run(
  "UPDATE version SET latest = ? WHERE rowid = 1",
  latest
)

/*
 * Static config
 */

const getLatestStaticConfig = () => db => db.get(
  `SELECT version, enable_paper_wallet_only, has_lightening, server_version, two_way_mode
   ORDER BY version DESC
   LIMIT 1`
)
exports.getLatestStaticConfig = () => withDB(getLatestStaticConfig())

const getStaticConfig = version => db => db.get(
  `SELECT version, enable_paper_wallet_only, has_lightening, server_version, two_way_mode WHERE version = ?`,
  version
)
exports.getStaticConfig = version => withDB(getStaticConfig(version))

/*
 * Ping URLs
 */

const getURLsToPing = () => db =>
  db.all("SELECT url FROM urls_to_ping")
    .map(({ url }) => url)
exports.getURLsToPing = () => withDB(getURLsToPing())

const deleteOldURLs = oldURLs => db =>
  oldURLs.length === 0 ?
    Promise.resolve() :
    db.run(
      "DELETE FROM urls_to_ping WHERE url IN " + sqlite.makeTuple(oldURLs.length),
      oldURLs
    )

const insertNewURLs = newURLs => db =>
  oldURLs.length === 0 ?
    Promise.resolve() :
    db.run(
      "INSERT INTO urls_to_ping (url) VALUES " + sqlite.makeValues(1, newURLs.length),
      newURLs
    )

exports.updateURLsToPing = newURLs =>
  withTx(db =>
    getURLsToPing()(db)
      .then(oldURLs => Promise.all([
        deleteOldURLs(setDifference(oldURLs, newURLs))(db),
        insertNewURLs(setDifference(newURLs, oldURLs))(db),
      ]))
  )
  .then(_ => newURLs)

/*
 * Speedtest files
 */

const getSpeedtestFiles = () => db =>
  db.all("SELECT url FROM speedtest_files")
exports.getSpeedtestFiles = () => withDB(getSpeedtestFiles())

const deleteOldFiles = oldFiles => db =>
  oldFiles.length === 0 ?
    Promise.resolve() :
    db.run(
      "DELETE FROM speedtest_files WHERE url IN " + sqlite.makeTuple(oldFiles.length),
      oldFiles
    )

const insertNewFiles = newFiles => db =>
  oldFiles.length === 0 ?
    Promise.resolve() :
    db.run(
      "INSERT INTO speedtest_files (url, size) VALUES " + sqlite.makeValues(2, newFiles.length),
      newFiles.map(({ url, size }) => [url, size]).flat()
    )

exports.updateSpeedtestFiles = newFiles =>
  withTx(db =>
    getSpeedtestFiles()(db)
      .then(oldFiles => Promise.all([
        deleteOldFiles(setDifference(oldFiles, newFiles))(db),
        insertNewFiles(setDifference(newFiles, oldFiles))(db),
      ]))
  )
  .then(_ => newFiles)

/*
 * Terms
 */

exports.getTerms = version =>
  get("SELECT hash FROM terms WHERE version = ?", version)
    .then(row => row ? getTermsByHash(row.hash) : null)

/*
 * Triggers automation
 */

const getTriggersAutomation = () => db => db.all("SELECT * FROM triggers_automation")
exports.getTriggersAutomation = () => withDB(getTriggersAutomation())

const deleteOldTriggersAutomation = triggersAutomation => db =>
  triggersAutomation.length === 0 ?
    Promise.resolve() :
    db.run(
      "DELETE FORM triggers_automation WHERE trigger_type IN " + sqlite.makeTuple(triggersAutomation.length),
      triggersAutomation.map(([t, _]) => t)
    )

const upsertTriggersAutomation = triggersAutomation => db =>
  triggersAutomation.length === 0 ?
    Promise.resolve() :
    db.run(
      `INSERT INTO triggers_automation (trigger_type, automatic)
      VALUES ${sqlite.makeValues(2, triggersAutomation.length)}
      ON CONFLICT (trigger_type) DO UPDATE SET automatic = excluded.automatic`,
      triggersAutomation.flat()
    )

exports.updateTriggersAutomation = newTriggersAutomation =>
  withTx(db =>
    getTriggersAutomation()(db)
      .then(oldTriggersAutomation => {
        oldTriggersAutomation = oldTriggersAutomation.map(({ trigger_type, automatic }) => [trigger_type, automatic === 1])
        const toDelete = oldTriggersAutomation
          .filter(([t, a]) => !Object.hasOwn(newTriggersAutomation, t))
        const toUpsert = Object.entries(newTriggersAutomation)
          .filter(([t, a]) => !oldTriggersAutomation.includes([t, a === 'Automatic']))
        return Promise.all([
          deleteOldTriggersAutomation(toDelete)(db),
          upsertTriggersAutomation(toUpsert)(db),
        ])
      })
  )
  .then(_ => newTriggersAutomation)

/*
 * Locale info
 */

const deleteLocaleInfo = () => db => db.run("DELETE FROM locale_info WHERE TRUE")
const deleteLocales = () => db => db.run("DELETE FROM locales WHERE TRUE")
const insertLocaleInfo = (country, fiatCode, primaryLocale) => db => db.run(
  "INSERT INTO locale_info (country, fiat_code, primary_locale) VALUES (?, ?, ?)",
  country, fiatCode, primaryLocale
)
const insertLocales = primaryLocales => db => db.run(
  "INSERT INTO locales (locale) VALUES " + sqlite.makeValues(1, primaryLocales.length),
  primaryLocales
)

exports.updateLocaleInfo = ({ country, fiatCode, localeInfo: { primaryLocale, primaryLocales } }) =>
  withTx(db =>
    Promise.all([
      deleteLocaleInfo()(db),
      deleteLocales()(db),
    ])
    .then(_ => Promise.all([
      insertLocaleInfo(country, fiatCode, primaryLocale),
      insertLocales(primaryLocales),
    ]))
  )
  .then(_ => locale)
