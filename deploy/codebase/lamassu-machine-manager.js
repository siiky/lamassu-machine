'use strict';

const fs = require('fs');
const async = require('./async');
const cp = require('child_process');
const report = require('./report').report;

const hardwareCode = process.argv[2];
const machineCode = process.argv[3];
const newPath = process.argv[4];

const basePath = newPath ? '/opt/lamassu-updates/extract' : '/tmp/extract'
const packagePath = `${basePath}/package/subpackage`

const machineWithMultipleCodes = ['upboard', 'up4000', 'coincloud', 'generalbytes', 'genmega']

const path = machineWithMultipleCodes.includes(hardwareCode) ?
  `${packagePath}/hardware/${hardwareCode}/${machineCode}` :
  `${packagePath}/hardware/${hardwareCode}`

const supervisorPath = machineWithMultipleCodes.includes(hardwareCode) ?
  `${packagePath}/supervisor/${hardwareCode}/${machineCode}` :
  `${packagePath}/supervisor/${hardwareCode}`

const udevPath = `${packagePath}/udev/aaeon`

const TIMEOUT = 600000;
const applicationParentFolder = hardwareCode === 'aaeon' ? '/opt/apps/machine' : '/opt'

const ignoreErrorsCallback = cb => err => err ? cb(err) : cb()

const command = (cmd, cb) => {
  console.log("Running command", cmd)
  return cp.exec(cmd, {timeout: TIMEOUT}, ignoreErrorsCallback(cb))
}

function updateUdev (cb) {
  if (hardwareCode !== 'aaeon') return cb()
  return async.series([
    async.apply(command, `cp ${udevPath}/* /etc/udev/rules.d/`),
    async.apply(command, 'udevadm control --reload-rules && udevadm trigger'),
  ], ignoreErrorsCallback(cb))
}

function updateSupervisor (cb) {
  if (hardwareCode === 'aaeon') return cb()
  return cp.exec('systemctl enable supervisor', {timeout: TIMEOUT}, function(err) {
    if (err) {
      console.log('failure activating systemctl')
    }

    async.series([
      async.apply(command, `cp ${supervisorPath}/* /etc/supervisor/conf.d/`),
      async.apply(command, `users | grep -q ubilinux && sed -i 's/user=machine/user=ubilinux/g' /etc/supervisor/conf.d/lamassu-browser.conf || true`),
      async.apply(command, 'supervisorctl update'),
    ], ignoreErrorsCallback(cb))
  })
}

function updateAcpChromium (cb) {
  if (hardwareCode !== 'aaeon') return cb()
  return async.series([
    async.apply(command, `cp ${path}/sencha-chrome.conf /home/iva/.config/upstart/`),
    async.apply(command, `cp ${path}/start-chrome /home/iva/`),
  ], ignoreErrorsCallback(cb))
}

function installDeviceConfig (cb) {
  try {
    const currentDeviceConfigPath = `${applicationParentFolder}/lamassu-machine/device_config.json`
    const newDeviceConfigPath = `${path}/device_config.json`

    // Updates don't necessarily need to carry a device_config.json file
    if (!fs.existsSync(newDeviceConfigPath)) return cb()

    const currentDeviceConfig = require(currentDeviceConfigPath)
    const newDeviceConfig = require(newDeviceConfigPath)

    if (currentDeviceConfig.cryptomatModel) {
      newDeviceConfig.cryptomatModel = currentDeviceConfig.cryptomatModel
    }
    if (currentDeviceConfig.billDispenser && newDeviceConfig.billDispenser) {
      newDeviceConfig.billDispenser.model = currentDeviceConfig.billDispenser.model
      newDeviceConfig.billDispenser.device = currentDeviceConfig.billDispenser.device
      newDeviceConfig.billDispenser.cassettes = currentDeviceConfig.billDispenser.cassettes
    }
    if (currentDeviceConfig.billValidator) {
      newDeviceConfig.billValidator.deviceType = currentDeviceConfig.billValidator.deviceType
      if (currentDeviceConfig.billValidator.rs232) {
        newDeviceConfig.billValidator.rs232.device = currentDeviceConfig.billValidator.rs232.device
      }
    }
    if (currentDeviceConfig.kioskPrinter) {
      newDeviceConfig.kioskPrinter.model = currentDeviceConfig.kioskPrinter.model
      newDeviceConfig.kioskPrinter.address = currentDeviceConfig.kioskPrinter.address

      if (currentDeviceConfig.kioskPrinter.maker) {
        newDeviceConfig.kioskPrinter.maker = currentDeviceConfig.kioskPrinter.maker
      }

      if (currentDeviceConfig.kioskPrinter.protocol) {
        newDeviceConfig.kioskPrinter.protocol = currentDeviceConfig.kioskPrinter.protocol
      }
    }
    if (currentDeviceConfig.compliance) {
      newDeviceConfig.compliance = currentDeviceConfig.compliance
    }

    // Pretty-printing the new configuration to retain its usual form.
    const adjustedDeviceConfig = JSON.stringify(newDeviceConfig, null, 2)
    fs.writeFileSync(currentDeviceConfigPath, adjustedDeviceConfig)

    return cb()
  } catch (err) {
    return cb(err)
  }
}

const upgrade = () => async.series([
  async.apply(command, `tar zxf ${basePath}/package/subpackage.tgz -C ${basePath}/package/`),
  async.apply(command, `cp -PR ${basePath}/package/subpackage/lamassu-machine ${applicationParentFolder}`),
  async.apply(command, `cp -PR ${basePath}/package/subpackage/hardware/${nodeModulesCode}/node_modules ${applicationParentFolder}/lamassu-machine/`),
  async.apply(command, `mv ${applicationParentFolder}/lamassu-machine/verify/verify.${hardwareCode === 'aaeon' ? '386' : 'amd64'} ${applicationParentFolder}/lamassu-machine/verify/verify`),
  async.apply(installDeviceConfig),
  async.apply(updateSupervisor),
  async.apply(updateUdev),
  async.apply(updateAcpChromium),
  cb => report(null, 'finished.', ignoreErrorsCallback(cb))
])

module.exports = { upgrade }
