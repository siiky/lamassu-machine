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

/* Static config */

const saveStaticConfig = ({
  version,
  enable_paper_wallet_only,
  has_lightening,
  server_version,
  timezone,
  two_way_mode,
  customer_authentication,
}, {
  country,
  fiatCode,
  localeInfo: { primaryLocale }
}) => db => db.run(
  `INSERT INTO static_config (
     rowid,
     version,
     enable_paper_wallet_only,
     has_lightening,
     server_version,
     timezone,
     two_way_mode,
     customer_authentication,
     country,
     fiat_code,
     primary_locale
   )
   VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (rowid) DO UPDATE SET
     version = excluded.version,
     enable_paper_wallet_only = excluded.enable_paper_wallet_only,
     has_lightening = excluded.has_lightening,
     server_version = excluded.server_version,
     timezone = excluded.timezone,
     two_way_mode = excluded.two_way_mode,
     customer_authentication = excluded.customer_authentication,
     country = excluded.country,
     fiat_code = excluded.fiat_code,
     primary_locale = excluded.primary_locale`,
  version, enable_paper_wallet_only, has_lightening, server_version, timezone, two_way_mode, customer_authentication,
  country, fiatCode, primaryLocale
)

const loadStaticConfig = db => db.get(
  `SELECT version, enable_paper_wallet_only, has_lightening, server_version, timezone, two_way_mode, customer_authentication, country, fiat_code, primary_locale
   FROM static_config
   WHERE rowid = 1`,
)

/* Ping URLs */

const deleteURLsToPing = db =>
  db.run("DELETE FROM urls_to_ping WHERE TRUE")

const insertURLsToPing = newURLs => db => db.run(
  "INSERT INTO urls_to_ping (url) VALUES " + sqlite.makeValues(1, newURLs.length),
  newURLs
)

const saveURLsToPing = newURLs => db =>
  deleteURLsToPing(db)
    .then(_ => insertURLsToPing(newURLs)(db))

const loadURLsToPing = db =>
  db.all("SELECT url FROM urls_to_ping")
    .then(urls => urls.map(({ url }) => url))

/* Speedtest files */

const deleteSpeedtestFiles = db =>
  db.run("DELETE FROM speedtest_files WHERE TRUE")

const insertSpeedtestFiles = newFiles => db =>
  db.run(
    "INSERT INTO speedtest_files (url, size) VALUES " + sqlite.makeValues(2, newFiles.length),
    newFiles.map(({ url, size }) => [url, size]).flat()
  )

const saveSpeedtestFiles = newFiles => db =>
  deleteSpeedtestFiles(db)
    .then(_ => insertSpeedtestFiles(newFiles)(db))

const loadSpeedtestFiles = db =>
  db.all("SELECT url, size FROM speedtest_files")

/* Terms */

const getTermsByHash => hash => db =>
  db.get(
    "SELECT hash, title, text, accept, cancel, tcphoto, delay FROM terms_by_hash WHERE hash = ?",
    hash
  )

const loadTerms = db =>
  db.get("SELECT hash FROM terms WHERE rowid = 1")
    .then(row => row ? getTermsByHash(row.hash)(db) : null)

const saveTermsHash = hash => db =>
  db.run("UPDATE terms SET hash = ? WHERE rowid = 1", hash)

const saveTermsByHash = ({ title, text, accept, cancel, tcphoto, delay }, hash) => db =>
  db.run(
    `INSERT INTO terms_by_hash (hash, title, text, accept, cancel, tcphoto, delay)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (hash) DO UPDATE SET
       hash = excluded.hash,
       title = excluded.title,
       text = excluded.text,
       accept = excluded.accept,
       cancel = excluded.cancel,
       tcphoto = excluded.tcphoto,
       delay = excluded.delay`,
    hash, title, text, accept, cancel, tcphoto, delay
  )

const saveTerms = (terms, hash) => db => Promise.all([
  saveTermsHash(hash)(db),
  saveTermsByHash(terms, hash)(db),
])

/* Triggers automation */

const deleteTriggersAutomation = db =>
  db.run("DELETE FORM triggers_automation WHERE TRUE")

const insertTriggersAutomation = triggersAutomation => db => {
  triggersAutomation = Object.entries(triggersAutomation)
  return db.run(
    "INSERT INTO triggers_automation (trigger_type, automatic) VALUES " + sqlite.makeValues(2, triggersAutomation.length),
    triggersAutomation.flat()
  )
}

const saveTriggersAutomation = triggersAutomation => db =>
  deleteTriggersAutomation(db)
    .then(_ => insertTriggersAutomation(triggersAutomation)(db))

const loadTriggersAutomation = db =>
  db.all("SELECT trigger_type, automatic FROM triggers_automation")
    .then(triggers =>
      triggers.reduce(
        (ret, {  trigger_type, automatic }) =>
          Object.assign(ret, { [trigger_type]: automatic }),
        {}
      )
    )

/* Locales */

const deleteLocales = db => db.run("DELETE FROM locales WHERE TRUE")

const insertLocales = primaryLocales => db => db.run(
  "INSERT INTO locales (locale) VALUES " + sqlite.makeValues(1, primaryLocales.length),
  primaryLocales
)

const saveLocales = ({ localeInfo: { primaryLocales } }) => db =>
  deleteLocales(db)
    .then(_ => insertLocales(primaryLocales)(db))

const loadLocales = db =>
  db.all("SELECT locale FROM locales")
    .then(locales => locales.map(({ locale }) => locale))

/* Public functions */

/* Called after the Trader's poll to save new configs */
exports.saveConfig = ({
  version,
  urlsToPing,
  speedtestFiles,
  triggersAutomation,
  locale,
  terms,
  termsHash,
}) => withTx(db => Promise.all([
  saveVersion(version)(db),
  saveStaticConfig(staticConfig, locale)(db),
  saveURLsToPing(urlsToPing)(db),
  saveSpeedtestFiles(speedtestFiles)(db),
  saveTriggersAutomation(triggersAutomation)(db),
  saveLocales(locale)(db),
  saveTerms(terms, termsHash)(db),
]))

/* Called on machine start-up to load the last known static config */
exports.loadConfig = () =>
  withTx(db =>
    Promise.all([
      loadStaticConfig(db)
      loadURLsToPing(db),
      loadSpeedtestFiles(db),
      loadTriggersAutomation(db),
      loadLocales(db),
      loadTerms(db),
    ]))
    .catch(err => err === 'ignore' ? Promise.resolve(null) : Promise.reject(err))
  ]))
  .then(config => {
    if (config === null) return null
    const [staticConfig, urlsToPing, speedtestFiles, triggersAutomation, locales, terms] = config
    return { staticConfig, urlsToPing, speedtestFiles, triggersAutomation, locales, terms }
  })
