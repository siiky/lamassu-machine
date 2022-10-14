const SerialPort = require('serialport')
const EventEmitter = require('events').EventEmitter
const util = require('util')
const _ = require('lodash/fp')

const BN = require('../bn')

const denominationsTable = require('./denominations')

const CashflowSc = function (config) {
  EventEmitter.call(this)
  this.fiatCode = null
  this.buf = Buffer.alloc(0)
  this.responseSize = null
  this.config = config
  this.serial = null
  this.ack = 0x0
  this.device = config.rs232.device
  this.enabledDenominations = 0x00
  this.currentStatus = null
}

module.exports = CashflowSc

util.inherits(CashflowSc, EventEmitter)
CashflowSc.factory = function factory (config) {
  return new CashflowSc(config)
}

const STX = 0x02
const ETX = 0x03
const ENQ = 0x05

function validatePacket (frame) {
  var frameLength = frame.length
  var checksum = computeChecksum(frame)
  if (frame[frameLength - 1] !== checksum) throw new Error('bad checksum')
  if (frame[frameLength - 2] !== ETX) throw new Error('no ETX present')
}

CashflowSc.prototype.setFiatCode = function setFiatCode (fiatCode) {
  this.fiatCode = fiatCode
}

CashflowSc.prototype.open = function open (cb) {
  const options = {
    baudRate: 9600,
    parity: 'even',
    dataBits: 7,
    stopBits: 1,
    autoOpen: false,
    rtscts: false
  }

  const serial = new SerialPort(this.device, options)
  this.serial = serial

  serial.on('error', err => this.emit('error', err))
  serial.on('open', () => {
    serial.on('data', data => this._process(data))
    serial.on('close', () => this.emit('disconnected'))
    this.emit('connected')
    cb()
  })

  serial.open()
}

CashflowSc.prototype.enable = function enable () {
  this.enabledDenominations = 0x7f // 7 bits, 1 bit for each denomination
  this._poll()
}

CashflowSc.prototype.disable = function disable () {
  this.enabledDenominations = 0x00
  this._poll()
}

CashflowSc.prototype.reject = function reject () {
  this._dispatch([this.enabledDenominations, 0x5f, 0x10])
}

CashflowSc.prototype.stack = function stack () {
  this._dispatch([this.enabledDenominations, 0x3f, 0x10])
}

CashflowSc.prototype._denominations = function _denominations () {
  return denominationsTable[this.fiatCode]
}

CashflowSc.prototype.lowestBill = function lowestBill (fiat) {
  var bills = this._denominations()
  const filtered = bills.filter(bill => fiat.lte(bill))
  if (_.isEmpty(filtered)) return BN(_.min(bills))
  return BN(_.min(filtered))
}

CashflowSc.prototype.highestBill = function highestBill (fiat) {
  var bills = this._denominations()
  var filtered = _.filter(bill => fiat.gte(bill), bills)
  if (_.isEmpty(filtered)) return BN(-Infinity)
  return BN(_.max(filtered))
}

CashflowSc.prototype.hasDenominations = function hasDenominations () {
  return !!this._denominations()
}

CashflowSc.prototype.run = function run (cb) {
  this.open(() => {
    this._dispatch([0x00, 0x1b, 0x10])
    this.poller = setInterval(() => this._poll(), 10000)
    cb()
  })
}

CashflowSc.prototype.close = function close (cb) {
  clearInterval(this.poller)
  this.serial.close(cb)
}

CashflowSc.prototype.lightOn = function lightOn () {}
CashflowSc.prototype.lightOff = function lightOff () {}
CashflowSc.prototype.monitorHeartbeat = function monitorHeartbeat () {}

CashflowSc.prototype._process = function _process (data) {
  if (this.buf.length === 0 && data.length === 1 && data[0] === ENQ) {
    return this._processEvent()
  }

  this.buf = Buffer.concat([this.buf, data])
  this.buf = this._acquireSync(this.buf)

  // Wait for size byte
  if (this.buf.length < 2) return

  var responseSize = this.buf[1]

  // Wait for whole packet
  if (this.buf.length < responseSize) return

  var packet = this.buf.slice(0, responseSize)
  this.buf = this.buf.slice(responseSize)

  try {
    this._parse(packet)
  } catch (ex) {
    console.log(ex)
    process.nextTick(() => this._process(data.slice(1)))
  }
}

// TODO
// Host -> BV
// - Add commands for stacking, returning
//
// BV -> Host
// - Detect escrow and stacked
// - Detect error conditions, such as cashbox out, rejected, jammed

CashflowSc.prototype._parse = function _parse (packet) {
  validatePacket(packet)
  var result = interpret(packet)
  if (!result) return

  var status = result.status
  if (this.currentStatus === status) return
  this.currentStatus = status

  console.log('DEBUG: %s', status)

  // For escrow, need to emit both billAccepted and billRead
  if (status === 'billRead') {
    if (!result.bill || result.bill.code !== this.fiatCode) {
      console.log("WARNING: Bill validator, shouldn't happen:", this.fiatCode)
      console.dir(result.bill && result.bill.code)
      return this.reject()
    }

    this.emit('billAccepted')
    return process.nextTick(() => this.emit('billRead', result.bill))
  }

  // This can happen when cashbox is re-inserted
  if (status === 'billValid' && result.bill && !result.bill.denomination) return

  if (status) return this.emit(status)
}

CashflowSc.prototype._acquireSync = function _acquireSync (data) {
  var payload = null
  for (var i = 0; i < data.length; i++) {
    if (data[i] === STX) {
      payload = data.slice(i)
      break
    }
  }

  return (payload || Buffer.alloc(0))
}

CashflowSc.prototype._processEvent = function _processEvent () {
  this._poll()
}

CashflowSc.prototype._dispatch = function _dispatch (data) {
  var frame = this._buildFrame(data)
  this.serial.write(frame)
}

CashflowSc.prototype._poll = function _poll () {
  /*
   * Byte 0 -- search for enabledDenominations
   *
   * Byte 1
   *  [0] > Special Interrup Mode (§4.1) -- use polled/interrupt mode
   *  [1] > High Security -- 0b0 recommended (high acceptance mode)
   *  [2..3] > Orientation Control (§5.2.3) -- 0x1x recommended (any way is accepted)
   *  [4] > Escrow Mode (§4.3) -- 0b1 recommended (enabled)
   *  [5] > Document Stack Command
   *  [6] > Document Return Command
   *
   * Byte 2
   *  [0] > No-Push Mode -- 0b0 recommended (stack the document but give no credit)
   *  [1] > Barcode -- enabled or not barcode documents
   *  [2..3] > Something to do with powerup
   *  [4] > Extended Note Reporting -- §4.2
   *  [5] > Extended Coupon Reporting
   *  [6] > Reserved
   *
   *
   * 0x1b = 0001 1011
   *  Interrupt mode
   *  High security
   *  Accept bills any way
   *  Escrow mode
   *  Document stack/return commands not on
   *
   * 0x10 = 0001 0000
   *  Put non-credit notes into the stacker
   *  No barcode documents
   *  Smth smth powerup...
   *  Extended note reporting enabled
   *  Extended coupon reporting disabled
   */
  this._dispatch([this.enabledDenominations, 0x1b, 0x10])
}

function parseStatus (data) {
  return data[0].escrowed ? 'billRead' :
    (data[0].accepting && data[0].stacking) ? 'billValid' :
    (data[0].returned || data[1].cheated || data[1].rejected) ? 'billRejected' :
    data[1].jammed ? 'jam' :
    !data[1].cassetteAttached ? 'stackerOpen' :
    data[0].idling ? 'idle' :
    null
}

const destructData = data => {
  if (data.length < 6) return null

  const getNth = n => b => Boolean((b >> n) & 0b1)
  const getNths = (f, t) => b => { // Interval closed on the left, open on the right
    const n = t - f
    const mask = (0b1 << n) - 1
    return (b >> f) & mask
  }

  const destructByte = (fields, byte) => _.mapValues(f => f(byte), fields)

  const B0 = destructByte({
    idling:    getNth(0), // Not processing a document
    accepting: getNth(1), // Drawing a document in
    escrowed:  getNth(2), // Valid document in escrow
    stacking:  getNth(3), // Stacking valid document
    stacked:   getNth(4), // Stacked valid document
    returning: getNth(5), // Returning document to customer
    returned:  getNth(6), // Returned document to customer
  }, data[0])

  const B1 = destructByte({
    cheated:          getNth(0), // Validator thinks customer tried to fraud the system
    rejected:         getNth(1), // Document was rejected and returned to customer
    jammed:           getNth(2), // Validator is jammed
    stackerFull:      getNth(3), // Cashbox is full
    cassetteAttached: getNth(4), // Is cashbox inside the validator?
    paused:           getNth(5), // Customer trying to feed document while validator is processing another document
    calibrating:      getNth(6), // Is validator calibrating?
  }, data[1])

  const B2 = destructByte({
    powerup:        getNth(0),     // Is validator powering up? Not ready to accept documents if yes
    invalidCommand: getNth(1),     // Validator received an invalid command
    failure:        getNth(2),     // Validator ist kaput!
    noteValue:      getNths(3, 6), // Only valid when in non-extended mode AND escrowed^stacked
    transportOpen:  getNth(6),     // ???
  }, data[2])

  const B3 = destructByte({
    stalled:            getNth(0), // Validator is stalled with a document in the path (doesn't apply to the SCAdv?)
    flashDownload:      getNth(1), // Validator is ready to download
    prestack:           getNth(2), // (DEPRECATED) Document can no longer be returned
    rawBarcode:         getNth(3), // ???
    deviceCapabilities: getNth(4), // Whether the validator supports or not the "Query Device Capabilities" command
    disabled:           getNth(5), // Is the validator disabled? Validator doesn't accept bills when disabled
    // 6th bit is reserved
  }, data[3])

  const B4 = destructByte({
    modelNumber: getNths(0, 7), // 84 ('T', 0x54) is the "Cashflow SC 83". See tbl at §7.1.2.5 for more.
  }, data[4])

  const B5 = destructByte({
    codeRevision: getNths(0, 7), // Version number of the firmware in the validator
  }, data[5])

  return [B0,B1,B2,B3,B4,B5]
}

function parseStandard (frame, { data }) {
  const destructedData = destructData(data)
  const status = parseStatus(data)
  return { status, destructed }
}

function parseExtended (frame, { data }) {
  const EXTENDED_OFFSET = 7
  const subType = data[0]
  const extendedData = data.slice(EXTENDED_OFFSET, EXTENDED_OFFSET+18)
  data = data.slice(1, EXTENDED_OFFSET)
  const destructedData = destructData(data)

  // 0x02 is the "Extended Note Specification Message" subtype
  if (subType !== 0x02) return null

  const destructedExtendedData = {
    index: extendedData[0],
    code: extendedData.slice(1, 4).toString('utf8'),
    base: parseInt(extendedData.slice(4, 7), 10),
    sign: extendedData[7] === 0x2b ? +1 :
          extendedData[7] === 0x2d ? -1 :
          null,
    exponent: parseInt(extendedData.slice(8, 10), 10),
    orientation: extendedData[10],
    type: extendedData[11],
    series: extendedData[12],
    compatibility: extendedData[13],
    version: extendedData[14],
    banknoteClassification: extendedData[15],
    reserved: extendedData.slice(15, 18)
  }

  const { code, base, sign, exponent } = destructedExtendedData
  const denomination = base * Math.pow(10, sign * exponent)

  const status = parseStatus(destructedData)

  return {
    status,
    bill: { denomination, code }
  }
}

/*
 * The control byte has the layout 0b0MMMDDDA, where M is the message type; D
 * is the device type; and A is the ACK/NAK bit.
 */
const destructCtlByte = ctl => ({
  ack: ctl & 0b1,

  /*
   * 0b000 => Bill acceptor
   * 0b001 => Bill recycler
   * _ => Reserved for future use
   */
  devType: (ctl >> 1) & 0b111, // Unused

  /*
   * Validator->Host message types:
   *  0b010 => Omnibus reply
   *  0b100 => Calibrate reply
   *  0b101 => Firmware download reply
   *  0b110 => Auxiliary command reply
   *  0b111 => Extended command/omnibus reply
   *  _ => Unused/Reserved
   */
  msgType: (ctl >> 4) & 0b111,
})

const destructFrame = frame => {
  const [stx, len, ctl, ...rest] = frame
  if (frame.length < 3 || frame.length !== len) return null
  const data = Buffer.from(rest.slice(0, len-5))
  const [etx, chk] = rest.slice(len-5)

  console.log('sanity:',
    stx === STX
    && etx === ETX
    && chk === computeChecksum(frame)
  )

  return {
    stx,
    len,
    ctl: destructCtlByte(ctl),
    data,
    etx,
    chk,
  }
}

function interpret (frame) {
  console.log('IN: %s', frame.toString('hex'))
  console.log('frame length:', frame.length)

  const destructedFrame = destructFrame(frame)
  console.log('destructedFrame:', destructedFrame)

  const { ctl: { msgType } } = destructedFrame

  return (msgType === 0b010) ? parseStandard(frame, destructedFrame) :
    (msgType === 0b111) ? parseExtended(frame, destructedFrame) :
    null
}

CashflowSc.prototype._buildFrame = function _buildFrame (data) {
  var length = data.length + 5
  if (length > 0xff) throw new Error('Data length is too long!')
  this.ack = ~this.ack & 0b1
  var ctl = 0x10 | this.ack // 0x10 is the "Omnibus Command" ctl byte
  var frame = [STX, length, ctl].concat(data, ETX, 0x00)
  var checksum = computeChecksum(frame)
  frame[frame.length - 1] = checksum
  return Buffer.from(frame)
}

// Works on both buffers and arrays
function computeChecksum (frame) {
  var cs = 0x00
  // Exclude STX, ETX and checksum fields
  for (var i = 1; i < frame.length - 2; i++) {
    cs = frame[i] ^ cs
  }
  return cs
}

/*
var bv = CashflowSc.factory({
  rs232: {device: '/dev/ttyUSB0'},
  currency: 'EUR'
})

bv.on('connected', function () { console.log('connected.'); })
bv.on('error', function (err) { console.log('Error: %s', err); })
bv.open(function () {
  bv._dispatch([0x7f, 0x1b, 0x10])
  bv.enable()
  setInterval(function() {
    bv._poll()
  }, 10000)
})

//setTimeout(function() { bv.enable(); }, 5000)

bv.on('billRead', function(denomination) {
  console.log('Got a bill: %d', denomination)
  bv.reject()
//  if (denomination === 5) bv.reject()
//  else bv.stack()
})

bv.on('billRejected', function() { console.log('Bill rejected'); })
bv.on('billAccepted', function() { console.log('Bill accepted'); })
bv.on('billValid', function() { console.log('Bill valid'); })
*/
