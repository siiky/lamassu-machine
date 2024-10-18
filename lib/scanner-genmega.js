const _ = require('lodash/fp')
const { utils: coinUtils } = require('@lamassu/coins')
const { bcs } = require('genmega')

const Pdf417Parser = require('./compliance/parsepdf417')
const scanner = require('./scanner')

let barcodeScannerPath = null
let gmrunning = false

function config (_configuration) {
  scanner.config(_configuration)
  scanner.setFPS(5)
  barcodeScannerPath = _.get(`scanner.device`, _configuration)
}

function cancel () {
  if (gmrunning) {
    gmrunning = false
    bcs.cancelScan()
  } else {
    scanner.cancel()
  }
}

const isOpened = () => gmrunning || scanner.isOpened()

const delay_callback = (callback, delay=100) => (err, ret) =>
  setTimeout(() => callback(err, ret), delay)

function scanPDF417 (callback) {
  callback = delay_callback(callback)
  gmrunning = true
  bcs.scan(barcodeScannerPath, 1)
    .then(({ decoded, return_int, return_code, return_message }) => {
      gmrunning = false
      if (return_int < 0 && return_code !== 'HM_DEV_CANCEL') return callback(new Error(return_message))
      if (return_code === 'HM_DEV_CANCEL' || !decoded) return callback(null, null)

      const parsed = Pdf417Parser.parse(decoded)
      if (!parsed) return callback(null, null)
      parsed.raw = decoded
      callback(null, parsed)
    })
}

function scanPairingCode (callback) {
  callback = delay_callback(callback)
  gmrunning = true
  bcs.scan(barcodeScannerPath, 1)
    .then(({ decoded, return_int, return_code, return_message }) => {
      gmrunning = false
      if (return_int < 0 && return_code !== 'HM_DEV_CANCEL') return callback(new Error(return_message))
      if (return_code === 'HM_DEV_CANCEL' || !decoded) decoded = null
      return callback(null, decoded)
    })
}

function scanMainQR (cryptoCode, shouldSaveAttempt, callback) {
  callback = delay_callback(callback)
  gmrunning = true
  bcs.scan(barcodeScannerPath, 1)
    .then(({ decoded, return_int, return_code, return_message }) => {
      gmrunning = false
      if (return_int < 0 && return_code !== 'HM_DEV_CANCEL') return callback(new Error(return_message))
      if (return_code === 'HM_DEV_CANCEL') return callback(null, null)
      if (!decoded) {
        console.log('scanner: Empty response from genmega lib', decoded)
        return callback(null, null)
      }
      console.log('DEBUG55: %s', decoded)
      const network = 'main'
      callback(null, coinUtils.parseUrl(cryptoCode, network, decoded))
    })
}

function scanPK (callback) {
  callback = delay_callback(callback)
  gmrunning = true
  bcs.scan(barcodeScannerPath, 0)
    .then(({ decoded, return_int, return_code, return_message }) => {
      gmrunning = false
      if (return_int < 0 && return_code !== 'HM_DEV_CANCEL') return callback(new Error(return_message))
      if (return_code === 'HM_DEV_CANCEL' || !decoded) decoded = null
      callback(null, decoded)
    })
}

function scanPhotoCard (callback) {
  callback(new Error('ID Card photo is not supported for genmega!'))
}

module.exports = {
  config,
  scanPairingCode,
  scanMainQR,
  scanPDF417,
  scanPhotoCard,
  takeFacephoto: scanner.takeFacephoto,
  cancel,
  isOpened,
  scanPK,
  getDelayMS: scanner.getDelayMS,
  hasCamera: scanner.hasCamera,
  takeFacePhotoTC: scanner.takeFacePhotoTC,
  delayedFacephoto: scanner.delayedFacephoto,
  delayedPhoto: scanner.delayedPhoto,
  diagnosticPhotos: scanner.diagnosticPhotos
}
