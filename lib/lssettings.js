'use strict'
const path = require('path')
const sqlite = require('./sqlite')

const root = path.join(__dirname, "..")
const dataPath = require(path.join(root, "device_config.json")).brain.dataPath

const filename = path.join(root, dataPath, "lssettings.sqlite")
const migrationsPath = path.join(root, "migrations/lssettings")

const Es = {}

const unzip = a => {
  const ls = a.map(([l, _]) => l)
  const rs = a.map(([_, r]) => r)
  return [ls, rs]
}

const zip = (as, bs) => as.map((a, idx) => [a, bs[idx]])

const assign = (to, from) => Object.assign(structuredClone(to), from)

const PromiseObject = obj => {
  const entries = Object.entries(obj)
  const [keys, promises] = unzip(entries)
  return Promise.all(promises)
    .then(results => Object.fromEntries(zip(keys, results)))
}

const getLastID = ({ lastID }) => lastID

module.exports = (readwrite=false) => {
  readwrite = !!readwrite
  let E = Es[readwrite]
  if (E) return E
  E = {}

  const dbPromise = sqlite.openCached(filename, readwrite)
    .then(db =>
      db.run("PRAGMA journal_mode = WAL")
        // TODO: Should we set synchronous mode to FULL?
        // @see https://www.sqlite.org/wal.html
        // @see https://www.sqlite.org/pragma.html#pragma_synchronous
        //.run("PRAGMA synchronous = FULL")
        .then(_ => db.migrate({ migrationsPath }))
        .then(_ => {
          // Ensures the DB file is properly saved and the WAL is cleaned up
          process.on('exit', async function (code) {
            await db.close()
          })
          return db
        })
    )

  const { withTx } = sqlite.helpers(dbPromise)

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
       number_of_recyclers,
       paper_receipt,
       sms_receipt
     )
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       number_of_recyclers = excluded.number_of_recyclers,

       paper_receipt = excluded.paper_receipt,
       sms_receipt = excluded.sms_receipt`,
    version, enable_paper_wallet_only, has_lightening, server_version, timezone, two_way_mode, customer_authentication,
    country, fiat_code, primary_locale,
    deviceName, numberOfCassettes, numberOfRecyclers,
    !!paper_receipt, !!sms_receipt
  )

  const loadStaticConfig = db => db.get(
    `SELECT version, enable_paper_wallet_only, has_lightening, server_version, timezone, two_way_mode, customer_authentication,
            country, fiat_code, primary_locale,
            device_name, number_of_cassettes, number_of_recyclers,
            paper_receipt, sms_receipt
     FROM static_config
     WHERE rowid = 1`
  )

  /* Ping URLs */

  const deleteURLsToPing = db =>
    db.run("DELETE FROM urls_to_ping WHERE TRUE")

  const insertURLsToPing = newURLs => db =>
    newURLs.length === 0 ?
      Promise.resolve() :
      db.run(
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
    newFiles.length === 0 ?
      Promise.resolve() :
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

  const loadTerms = db =>
    db.get("SELECT hash, title, text, accept, cancel, tcphoto, delay FROM terms WHERE rowid = 1")

  const insertTerms = (hash, { title, text, accept, cancel, tcphoto, delay }) => db =>
    db.run(
      `INSERT INTO terms (rowid, hash, title, text, accept, cancel, tcphoto, delay)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (rowid) DO UPDATE SET
         hash = excluded.hash,
         title = excluded.title,
         text = excluded.text,
         accept = excluded.accept,
         cancel = excluded.cancel,
         tcphoto = excluded.tcphoto,
         delay = excluded.delay`,
      hash, title, text, accept, cancel, tcphoto, delay
    )

  const deleteTerms = db => db.run("DELETE FROM terms WHERE TRUE")

  const saveTerms = (hash, terms) => db => hash ?
    insertTerms(hash, terms)(db) :
    deleteTerms(db)

  /* Triggers automation */

  const deleteTriggersAutomation = db =>
    db.run("DELETE FROM triggers_automation WHERE TRUE")

  const insertTriggersAutomation = triggersAutomation => db => {
    triggersAutomation = Object.entries(triggersAutomation)
    return db.run(
      "INSERT INTO triggers_automation (trigger_type, automation_type) VALUES " + sqlite.makeValues(2, triggersAutomation.length),
      triggersAutomation.flat()
    )
  }

  const saveTriggersAutomation = triggersAutomation => db =>
    deleteTriggersAutomation(db)
      .then(_ => insertTriggersAutomation(triggersAutomation)(db))

  const loadTriggersAutomation = db =>
    db.all("SELECT trigger_type, automation_type FROM triggers_automation")
      .then(triggers =>
        triggers.reduce(
          (ret, { trigger_type, automation_type }) =>
            Object.assign(ret, { [trigger_type]: automation_type }),
          {}
        )
      )

  /* Triggers */

  const deleteTriggers = db => Promise.all([
    'triggers',
    'custom_info_requests',
    'custom_requests',
    'custom_screen',
    'custom_input_choice_list',
    'custom_inputs',
  ].map(table => db.run(`DELETE FROM ${table} WHERE TRUE`)))

  const insertTrigger = db => ({
    id,
    direction,
    requirement,
    triggerType,
    suspensionDays,
    threshold,
    thresholdDays,
    customInfoRequest,
    externalService,
  }) =>
    db.run(
      `INSERT INTO triggers (
         id,
         direction,
         requirement,
         trigger_type,
         suspension_days,
         threshold,
         threshold_days,
         custom_info_request,
         external_service
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      direction,
      requirement,
      triggerType,
      suspensionDays,
      threshold,
      thresholdDays,
      customInfoRequest,
      externalService,
    )

  const insertCustomInfoRequest = db => ({ id, enabled, customRequest }) =>
    db.run(
      "INSERT INTO custom_info_requests (id, enabled, custom_request) VALUES (?, ?, ?)",
      id, enabled, customRequest
    )
    .then(getLastID)

  const insertCustomRequest = db => ({ name, input, screen1, screen2 }) =>
    db.run(
      "INSERT INTO custom_requests (name, input, screen1, screen2) VALUES (?, ?, ?, ?)",
      name, input, screen1, screen2
    )
    .then(getLastID)

  const insertCustomScreen = ({ text, title }) => db =>
    db.run("INSERT INTO custom_screen (text, title) VALUES (?, ?)", text, title)
      .then(getLastID)

  const saveCustomInputChoiceList = (customInputID, choiceList) => db =>
    db.run(
      "INSERT INTO custom_input_choice_list (custom_input, choice_text) VALUES " + sqlite.makeValues(2, choiceList.length),
      choiceList.map(text => [customInputID, text]).flat()
    )
    .then(_ => customInputID)

  const insertCustomInput = ({ type, constraintType, label1, label2 }) => db =>
    db.run(
      "INSERT INTO custom_inputs (type, constraint_type, label1, label2) VALUES (?, ?, ?, ?)",
      type, constraintType, label1, label2
    )
    .then(getLastID)

  const saveCustomInput = customInput => db =>
    insertCustomInput(customInput)(db)
      .then(customInputID => saveCustomInputChoiceList(customInputID, customInput.choiceList)(db))

  const saveCustomRequest = customRequest => db =>
    PromiseObject({
      input: saveCustomInput(customRequest.input)(db),
      screen1: insertCustomScreen(customRequest.screen1)(db),
      screen2: insertCustomScreen(customRequest.screen2)(db),
    })
    .then(from => assign(customRequest, from))
    .then(insertCustomRequest(db))

  const saveCustomInfoRequest = customInfoRequest => db =>
    saveCustomRequest(customInfoRequest.customRequest)(db)
      .then(customRequest => assign(customInfoRequest, { customRequest }))
      .then(insertCustomInfoRequest(db))

  /*
   * NOTE: Recursively save all constituents of a trigger, replacing the
   * respective field with its ID in the DB, thus preparing the object for
   * insertion. For example, saveCustomInfoRequest() returns the ID of the
   * inserted custom_info_request; saveTrigger() updates its customInfoRequest
   * field to this ID; and finally inserts it into the DB.
   */
  const saveTrigger = db => trigger => (
    trigger.customInfoRequest === null ?
      Promise.resolve(trigger) :
      saveCustomInfoRequest(trigger.customInfoRequest)(db)
        .then(customInfoRequest => assign(trigger, { customInfoRequest }))
  ).then(insertTrigger(db))

  const saveTriggers = triggers => db =>
    deleteTriggers(db)
      .then(_ => Promise.all(triggers.map(saveTrigger(db))))

  const getCustomInput = customInput => db =>
    db.get(
      "SELECT type, constraint_type, label1, label2 FROM custom_inputs WHERE rowid = ?",
      customInput
    )
    .then(({ type, constraint_type, label1, label2 }) => ({
      type, constraintType: constraint_type, label1, label2
    }))

  const loadCustomInputChoiceList = customInput => db =>
    db.all(
      "SELECT choice_text FROM custom_input_choice_list WHERE custom_input = ?",
      customInput
    )
    .then(choiceList => choiceList.map(({ choice_text }) => choice_text))

  const loadCustomInput = customInput => db =>
    Promise.all([
      getCustomInput(customInput)(db),
      loadCustomInputChoiceList(customInput)(db),
    ])
    .then(([customInput, choiceList]) => Object.assign(customInput, { choiceList }))

  const loadCustomScreen = customScreen => db =>
    db.get("SELECT text, title FROM custom_screen WHERE rowid = ?", customScreen)

  const loadCustomRequest = customRequest => db =>
    db.get(
      "SELECT name, input, screen1, screen2 FROM custom_requests WHERE rowid = ?",
      customRequest
    )
    .then(customRequest =>
      PromiseObject({
        input: loadCustomInput(customRequest.input)(db),
        screen1: loadCustomScreen(customRequest.screen1)(db),
        screen2: loadCustomScreen(customRequest.screen2)(db),
      })
      .then(from => Object.assign(customRequest, from))
    )

  const loadCustomInfoRequest = rowid => db =>
    db.get(
      "SELECT id, enabled, custom_request FROM custom_info_requests WHERE rowid = ?",
      rowid
    )
    .then(({ id, enabled, custom_request }) =>
      loadCustomRequest(custom_request)(db)
        .then(customRequest => ({ id, enabled, customRequest }))
    )

  const loadTrigger = trigger => db =>
    !trigger.customInfoRequest ?
      Promise.resolve(trigger) :
      loadCustomInfoRequest(trigger.customInfoRequest)(db)
        .then(customInfoRequest => Object.assign(trigger, { customInfoRequest }))

  const loadTriggers = db =>
    db.all(
      `SELECT
         id,
         direction,
         requirement,
         trigger_type,
         suspension_days,
         threshold,
         threshold_days,
         custom_info_request,
         external_service
       FROM triggers`
    )
    .then(triggers => Promise.all(
      (triggers ?? [])
        .map(({
          id,
          direction,
          requirement,
          trigger_type,
          suspension_days,
          threshold,
          threshold_days,
          custom_info_request,
          external_service
        }) => loadTrigger({
          id: id,
          direction: direction,
          requirement: requirement,
          triggerType: trigger_type,
          suspensionDays: suspension_days,
          threshold: threshold,
          thresholdDays: threshold_days,
          customInfoRequest: custom_info_request,
          externalService: external_service,
        })(db))
    ))

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

  /* Coins */

  const deleteCoins = db => db.run("DELETE FROM coins WHERE TRUE")
  const insertCoins = coins => db =>
    db.run(
      `INSERT INTO coins (
         crypto_code,
         crypto_code_display,
         display,
         minimum_tx,
         cash_in_fee,
         cash_in_commission,
         cash_out_commission,
         crypto_network,
         crypto_units,
         batchable,
         is_cash_in_only
       ) VALUES` + sqlite.makeValues(11, coins.length),
      coins.map(({
        cryptoCode,
        cryptoCodeDisplay,
        display,
        minimumTx,
        cashInFee,
        cashInCommission,
        cashOutCommission,
        cryptoNetwork,
        cryptoUnits,
        batchable,
        isCashInOnly,
      }) => [
        cryptoCode,
        cryptoCodeDisplay,
        display,
        minimumTx,
        cashInFee,
        cashInCommission,
        cashOutCommission,
        cryptoNetwork,
        cryptoUnits,
        batchable,
        isCashInOnly,
      ]).flat()
    )

  const saveCoins = coins => db =>
    deleteCoins(db)
      .then(_ => insertCoins(coins)(db))

  const loadCoins = db =>
    db.all(
      `SELECT crypto_code,
              crypto_code_display,
              display,
              minimum_tx,
              cash_in_fee,
              cash_in_commission,
              cash_out_commission,
              crypto_network,
              crypto_units,
              batchable,
              is_cash_in_only
       FROM coins`
    )
    .then(coins =>
        (coins ?? []).map(
          ({
            crypto_code,
            crypto_code_display,
            display,
            minimum_tx,
            cash_in_fee,
            cash_in_commission,
            cash_out_commission,
            crypto_network,
            crypto_units,
            batchable,
            is_cash_in_only
          }) => ({
            cryptoCode: crypto_code,
            cryptoCodeDisplay: crypto_code_display,
            display,
            minimumTx: minimum_tx,
            cashInFee: cash_in_fee,
            cashInCommission: cash_in_commission,
            cashOutCommission: cash_out_commission,
            cryptoNetwork: crypto_network,
            cryptoUnits: crypto_units,
            batchable,
            isCashInOnly: is_cash_in_only,
          })
        )
    )

  /* Operator info */

  const deleteOperatorInfo = db => db.run("DELETE FROM operator_info WHERE TRUE")
  const insertOperatorInfo = ({ name, phone, email, website, companyNumber }) => db =>
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

  const saveOperatorInfo = operatorInfo => db =>
    deleteOperatorInfo(db)
      .then(_ => operatorInfo ? insertOperatorInfo(operatorInfo) : null)

  const loadOperatorInfo = db =>
    db.get(
      `SELECT name, phone, email, website, company_number
       FROM operator_info
       WHERE rowid = 1`
    )
    .then(operatorInfo =>
      operatorInfo === undefined ?
        { active: false } :
        Object.assign(
          operatorInfo,
          { active: true, companyNumber: operatorInfo.company_number }
        )
    )

  /* Receipt info */

  const deleteReceiptOptions = db =>
    db.run("DELETE FROM receipt_options WHERE TRUE")

  const insertReceiptOptions = receiptOptions => db => {
    receiptOptions = Object.entries(receiptOptions)
    if (receiptOptions.length === 0) return Promise.resolve()
    return db.run(
      "INSERT INTO receipt_options (field, enabled) VALUES " + sqlite.makeValues(2, receiptOptions.length),
      receiptOptions.flat()
    )
  }

  const saveReceiptOptions = receiptOptions => db =>
    deleteReceiptOptions(db)
      .then(_ => insertReceiptOptions(receiptOptions ?? {})(db))

  const loadReceiptOptions = db =>
    db.all("SELECT field, enabled FROM receipt_options")
      .then(receiptOptions =>
        (receiptOptions ?? []).reduce(
          (ret, { field, enabled }) =>
            Object.assign(ret, { [field]: enabled }),
          {}
        )
      )

  /* Public functions */

  /* Called after the Trader's poll to save new configs */
  E.saveConfig = ({
    coins,
    locales,
    machineInfo,
    operatorInfo,
    receiptOptions,
    speedtestFiles,
    staticConfig,
    terms,
    termsHash,
    triggersAutomation,
    triggers,
    urlsToPing,
  }) =>
    withTx(db => PromiseObject({
      coins: saveCoins(coins)(db),
      locales: saveLocales(locales)(db),
      operatorInfo: saveOperatorInfo(operatorInfo)(db),
      receiptOptions: saveReceiptOptions(receiptOptions)(db),
      speedtestFiles: saveSpeedtestFiles(speedtestFiles)(db),
      staticConfig: saveStaticConfig(staticConfig, locales, machineInfo)(db),
      terms: saveTerms(termsHash, terms)(db),
      triggersAutomation: saveTriggersAutomation(triggersAutomation)(db),
      triggers: saveTriggers(triggers)(db),
      urlsToPing: saveURLsToPing(urlsToPing)(db),
    }))

  E.saveTerms = ({ termsHash, terms }) => withTx(saveTerms(termsHash, terms))

  /* Called on machine start-up to load the last known static config */
  E.loadConfig = () =>
    withTx(db => PromiseObject({
      coins: loadCoins(db),
      locales: loadLocales(db),
      operatorInfo: loadOperatorInfo(db),
      receiptOptions: loadReceiptOptions(db),
      speedtestFiles: loadSpeedtestFiles(db),
      staticConfig: loadStaticConfig(db),
      terms: loadTerms(db),
      triggersAutomation: loadTriggersAutomation(db),
      triggers: loadTriggers(db),
      urlsToPing: loadURLsToPing(db),
    }))
    .then(config =>
      (config === undefined || config.staticConfig === undefined) ?
        null :
        config
    )
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
