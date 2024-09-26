'use strict'
const path = require('path')
const sqlite = require('./sqlite')

const root = path.join(__dirname, "..")
const dataPath = require(path.join(root, "device_config.json")).brain.dataPath

const filename = path.join(root, dataPath, "lssettings.sqlite")
const migrationsPath = path.join(root, "migrations")

const Es = {}

module.exports = (readwrite=false) => {
  readwrite = !!readwrite

  let E = Es[readwrite]
  if (E) return E

  E = {}

  const dbPromise = sqlite.openCached(filename, readwrite)
    .then(db =>
      db.run("PRAGMA journal_mode = WAL")
        .then(_ => db.migrate({ migrationsPath }))
        .then(_ => db)
    )

  dbPromise.then(db => {
    process.on('exit', code => {
      // Ensures the DB file is properly saved and the WAL is cleaned up
      await db.close()
    })
  }

  const { withTx } = sqlite.helpers(dbPromise)

  const unzip = a => {
    const ls = a.map(([l, _]) => l)
    const rs = a.map(([_, r]) => r)
    return [ls, rs]
  }

  const zip = (as, bs) => as.map((a, idx) => [a, bs[idx]])

  const PromiseObject = obj => {
    const entries = Object.entries(obj)
    const [keys, promises] = unzip(entries)
    return Promise.all(promises)
      .then(results => Object.fromEntries(zip(keys, results)))
  }

  /* Static config */

  const saveStaticConfig = ({
    version,
    enable_paper_wallet_only,
    has_lightening,
    server_version,
    timezone,
    two_way_mode,
    customer_authentication,
    paper_receipt,
    sms_receipt,
  }, { // LocaleInfo
    country,
    fiat_code,
    primary_locale,
  }, { // MachineInfo
    deviceName,
    numberOfCassettes,
    numberOfRecyclers,
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
       primary_locale,

       device_name,
       number_of_cassettes,
       number_of_recyclers
     )
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       primary_locale = excluded.primary_locale,

       device_name = excluded.device_name,
       number_of_cassettes = excluded.number_of_cassettes,
       number_of_recyclers = excluded.number_of_recyclers
      `,
    version, enable_paper_wallet_only, has_lightening, server_version, timezone, two_way_mode, customer_authentication,
    country, fiat_code, primary_locale,
    deviceName, numberOfCassettes, numberOfRecyclers,
  )

  const loadStaticConfig = db => db.get(
    `SELECT version, enable_paper_wallet_only, has_lightening, server_version, timezone, two_way_mode, customer_authentication,
            country, fiat_code, primary_locale,
            device_name, number_of_cassettes, number_of_recyclers
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

  const saveTerms = (terms, hash) => db => PromiseObject({
    termsHash: saveTermsHash(hash)(db),
    terms: saveTermsByHash(terms, hash)(db),
  })

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

  const saveLocales = ({ locales }) => db =>
    deleteLocales(db)
      .then(_ => insertLocales(locales)(db))

  const loadLocales = db =>
    db.all("SELECT locale FROM locales")
      .then(locales => locales.map(({ locale }) => locale))

  /* Operator info */

  const saveOperatorInfo = ({ name, phone, email, website, company_number }) => db =>
    db.run(
      `INSERT INTO operator_info (rowid, name, phone, email, website, company_number)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT (rowid) DO UPDATE SET
         name = excluded.name,
         phone = excluded.phone,
         email = excluded.email,
         website = excluded.website,
         company_number = excluded.company_number`,
      name, phone, email, website, company_number
    )

  const loadOperatorInfo = db =>
    db.get(
      `SELECT name, phone, email, website, company_number
       FROM operator_info
       WHERE rowid = 1`
    )
    .then(operatorInfo =>
      operatorInfo === null ?
        { active: false } :
        Object.assign(operatorInfo, { active: true })
    )

  /* Receipt info */

  const deleteReceiptOptions = db =>
    db.run("DELETE FROM receipt_info WHERE TRUE")

  const insertReceiptOptions = receiptOptions => db => {
    receiptOptions = Object.entries(receiptOptions)
    return db.run(
      "INSERT INTO receipt_info (field, enabled) VALUES " + sqlite.makeValues(2, receiptOptions.length),
      receiptOptions.flat()
    )
  }

  const saveReceiptOptions = ({ receiptOptions }) => db =>
    deleteReceiptOptions(db)
      .then(_ => insertReceiptOptions(receiptOptions)(db))

  const loadReceiptOptions = db =>
    db.all("SELECT field, enabled FROM receipt_info")
      .then(receiptOptions =>
        receiptOptions === null ?
          null :
          receiptOptions.reduce(
            (ret, { field, enabled }) =>
              Object.assign(ret, { [field]: enabled }),
            {}
          )
      )

  /* Public functions */

  /* Called after the Trader's poll to save new configs */
  E.saveConfig = ({
    locales,
    machineInfo,
    operatorInfo,
    receiptOptions,
    speedtestFiles,
    staticConfig,
    terms,
    termsHash,
    triggersAutomation,
    urlsToPing,
  }) =>
    withTx(db => PromiseObject({
      locales: saveLocales(locales)(db),
      operatorInfo: saveOperatorInfo(operatorInfo)(db),
      receiptOptions: saveReceiptOptions(receiptOptions)(db),
      speedtestFiles: saveSpeedtestFiles(speedtestFiles)(db),
      staticConfig: saveStaticConfig(staticConfig, locales, machineInfo)(db),
      terms: saveTerms(terms, termsHash)(db),
      triggersAutomation: saveTriggersAutomation(triggersAutomation)(db),
      urlsToPing: saveURLsToPing(urlsToPing)(db),
    }))

  /* Called on machine start-up to load the last known static config */
  E.loadConfig = () =>
    withTx(db => PromiseObject({
      locales: loadLocales(db),
      operatorInfo: loadOperatorInfo(db),
      receiptOptions: loadReceiptOptions(db),
      speedtestFiles: loadSpeedtestFiles(db),
      staticConfig: loadStaticConfig(db),
      terms: loadTerms(db),
      triggersAutomation: loadTriggersAutomation(db),
      urlsToPing: loadURLsToPing(db),
    }))
    .catch(err => err === 'ignore' ? Promise.resolve(null) : Promise.reject(err))

  E.loadMachineInfo = () =>
    withDB(loadStaticConfig)
      .then(config =>
        config === null ?
          { active: false } :
          {
            active: true,
            deviceName: config.device_name,
            numberOfCassettes: config.number_of_cassettes,
            numberOfRecyclers: config.number_of_recyclers,
          }
      )

  return Es[readwrite] = E
}
