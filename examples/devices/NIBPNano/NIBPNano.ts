'use strict';

import {
   DuplexDeviceConnection,
   StreamRingBuffer,
   IDeviceProxySettingsSys,
   ProxyDeviceSys,
   IDeviceStreamConfiguration,
   IDeviceSetting,
   DeviceValueType,
   IDeviceInputSettingsSys,
   IDeviceStreamApi,
   IDeviceStreamApiImpl,
   UnitsInfo,
   UnitPrefix,
   IDuplexStream,
   IDeviceClass,
   DeviceEvent,
   OpenPhysicalDevice,
   IProxyDevice,
   SysStreamEventType,
   TDeviceConnectionType,
   BlockDataFormat,
   OpenPhysicalDeviceDescriptor,
   IDeviceUIApi,
   IUIElementApi,
   IDeviceSettingsApi,
   IDeviceManagerApi,
   IUIAreaApi,
   DeviceProxyId,
   TMessageSeverity,
   IDeviceProxyAPI
} from '../../../public/device-api';

import { Setting } from '../../../public/device-settings';

import { UnitsInfoImpl } from '../../../public/device-units';

import {
   DuplexStream,
   concatTypedArrays
} from '../../../public/device-streams';

import { StreamRingBufferImpl } from '../../../public/stream-ring-buffer';

import { PluginFeatureTypes } from '../../../public/plugin-api';

/**
 * Device driver for FMS Nano Core OEM
 *
 * Notes:
 * - Quark is Lightning's C++ sampling engine.
 * - In order for this file to be registered by Lightning, it must be located
 *   under [LIGHTNING_INSTALL_DIR]/resources/app/devices
 * - Technical term: "Device class" is the set of types of device that can share the same settings.
 *
 * This file contains definitions for three necessary objects:
 *
 * 1. PhysicalDevice: an object that is a representation of the connected hardware device.
 *    Multiple recordings can use the same PhysicalDevice, but only one can sample with that device at any time.
 *
 * 2. ProxyDevice: an object that is created for each recording to represent the PhysicalDevice.
 *    Manages the device settings and access to sampling for that recording.
 *
 * 3. DeviceClass: an object that represents the device class and can find and create PhysicalDevice
 *    objects of its class, as well as the ProxyDevice objects.
 */

const kSupportedSamplesPerSec = [200];

export const kDefaultSamplesPerSecIndex = 0;
export const kDefaultSamplesPerSec = kSupportedSamplesPerSec[kDefaultSamplesPerSecIndex];

export function findClosestSupportedRateIndex(samplesPerSec: number) {
   let result = kSupportedSamplesPerSec.findIndex((value) => value <= samplesPerSec);
   if (result < 0) {
      return kSupportedSamplesPerSec.length - 1;
   }
   return result;
}

export function findClosestSupportedRate(samplesPerSec: number) {
   return kSupportedSamplesPerSec[findClosestSupportedRateIndex(samplesPerSec)];
}


const kDefaultCuffSwitchingInterval = 15;

const nanoErrorArray = [
   ['NoError', ''],
   ['GeneralError', ''],
   [
      'LedContr_erro_LowControlVolt',
      'Please check the wrist unit and restart the device.'
   ],
   [
      'LedContr_erro_HighControlVolt',
      'Unable to set correct LED current. Please restart the device.'
   ],
   [
      'LedContr_erro_HighLedCurrent',
      'Unable to set correct LED current. Please restart the device.'
   ],
   [
      'LedContr_erro_TooManyIteratio',
      'Unable to set correct LED current. Please restart the device.'
   ],
   [
      'LedContr_erro_CurrBelowDrift',
      'Finger cuff (or cuff cable) loose or not connected.'
   ],
   [
      'LedContr_erro_CurrAboveDrift',
      'Unable to set correct LED current. Please restart the device.'
   ],
   [
      'LedContr_erro_VoltBelowRange',
      'Unable to set correct LED current. Please restart the device.'
   ],
   [
      'LedContr_erro_VoltAboveRange',
      'Unable to set correct LED current. Please restart the device.'
   ],
   [
      'Plethysm_erro_TooMuchLight',
      'The infrared level transmitted through the finger is too high. Try a smaller finger cuff.'
   ],
   [
      'PhysScan_erro_SyncBeatTimeOut',
      'Odd plethysmogram detected, probably due to pressing the cuff or finger-tip.'
   ],
   [
      'PhysScan_erro_ScanFailed',
      'No blood pressure signal. May be: finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'PhysScan_erro_BeatDownTimeOut',
      'No plethysmogram detected. Check proper application of the finger cuff.'
   ],
   [
      'PresMoni_erro_IncorrectPress',
      'Cuff pressure error. Please check the cuff air hose.'
   ],
   [
      'PresMoni_erro_UnstablePress',
      'Cuff pressure unstable. Please check the cuff air hose.'
   ],
   [
      'ManoBeDe_erro_PressTooLow',
      'Cuff pressure too low. Please check the cuff air hose.'
   ],
   [
      'SignInMo_erro_MeanPressLow',
      'Mean pressure has been below 10mmHg for 2.5s. Please check the cuff air hose.'
   ],
   [
      'SignInMo_erro_UnacceptableP',
      'The plethysmogram values moved out of range. This may be a movement artifact.'
   ],
   [
      'SignInMo_erro_MeanPressHigh',
      'Mean pressure has been above 250 mmHg for 2.5s. Please check the cuff air hose.'
   ],
   [
      'PreContr_erro_CuffPreSensRang',
      'Cuff pressure sensor out of range. Check if the finger cuff is wrapped tight enough around the finger.'
   ],
   [
      'PreContr_erro_VolPreSensRang',
      'Volume pressure sensor out of range. Please check the cuff air hose.'
   ],
   [
      'PreContr_erro_CuffPreExceed',
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'PreContr_erro_CuffPreExceLong',
      'Mean pressure has been above 250 mmHg for 2.5s. Please check the cuff air hose.'
   ],
   [
      'PreContr_erro_VolPreExceed',
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'PreContr_erro_CurrExceedLong',
      'Current exceeded for too long. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_VoltageSenseFailure',
      'One of the internal voltages being monitored has failed. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_HcuRefSenseFailure',
      'Monitoring the reference voltage of the HCU has failed. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_PletRefSenseFailure',
      'Plethysmograph reference monitor failed. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_HouseTempSenseFailure',
      'Housing temperature sensor error. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_cuffPressureSenseFailure',
      'Cuff pressure sensor failure. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_volumePressureSenseFailure',
      'Cuff pressure sensor failure. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_VoltageOutLimits',
      'Supply voltage error. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_HcuRefOutLimits',
      'Plethysmograph ref out of limits. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_PletRefOutLimits',
      'Plethysmograph ref out of limits. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_cuffPressureSignalOffset',
      'Pressure signal offset too large. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_volumePressureSignalOffset',
      'Pressure signal offset too large. Please keep the wrist unit stable during its start-up.'
   ],
   [
      'SysIntgr_erro_pressureSensorTimeout',
      'Plethysmograph ref out of limits. Please keep the wrist unit stable during its start-up.'
   ],
   [
      'AppContr_erro_PressureToHigh',
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'AppContr_erro_caseTemperatureOutLimits',
      'The housing of the wrist unit is too hot. Please check convection possibilities around the wrist unit.'
   ],
   [
      'AppContr_erro_pcbTemperatureOutLimits',
      'The processor of the wrist unit is too hot. Please check convection possibilities around the wrist unit.'
   ],
   [
      'AppContr_erro_MeasurementToLong',
      'The maximum time of 4 hours for measuring on a single cuff has exceeded. Please switch to another cuff.'
   ],
   [
      'HcuContr_erro_hcuOffsetToBig',
      'HCU offset too large. Please retry zeroing.'
   ],
   [
      'HcuContr_erro_NotAllowed',
      'HCU can not be zeroed during sampling. Please stop recording if HCU zeroing is needed.'
   ],
   [
      'AppContr_erro_KeepAliveNotReceived',
      'The Keep Alive package has not been received in time from LabChart. Please check cables and restart the device and LabChart.'
   ],
   ['Driver_erro_SensorFailed', 'Driver_erro_SensorFailed']
];

const kStreamNames = [
   'Finger Pressure',
   'HCU Pressure',
   'Systolic',
   'Mean Arterial',
   'Diastolic',
   'Heart Rate',
   'Interbeat Interval',
   'Active Cuff',
   'Cuff Countdown',
   'AutoCal Quality',
   'AutoCalc Countdown'
];

/**
 * Calculates CRC for the payload of the Nano messages
 * CRC-8 Dallas/Maxim - x^8 + x^5 + x^4 + x^1
 */
function CheckCRC(payload: any, payloadCrc: any) {
   let calcdCrc = 0;

   for (let chrCount = 0; chrCount < payload.length; chrCount++) {
      let chr = payload[chrCount];

      for (let bitCount = 0; bitCount < 8; bitCount++) {
         const mix = (chr ^ calcdCrc) & 0x01;

         calcdCrc >>= 1;
         chr >>= 1;

         if (mix) {
            calcdCrc ^= 0x8c;
         }
      }
   }

   return payloadCrc == calcdCrc;
}

function findVersionData(byteArray: Buffer, versionCmdKeyInd: number): string {
   const versionCmdKey = Object.keys(NanoRxVersionCmds)[versionCmdKeyInd];
   const versionCmd = NanoRxVersionCmds[versionCmdKey];

   let versionStruct = '';
   let vcmdPos = 0;

   do {
      vcmdPos = byteArray.indexOf(versionCmd[4], vcmdPos + 1);

      let versionPacketCheck = true;
      for (let i = 0; i < versionCmd.length; i++) {
         versionPacketCheck =
            versionPacketCheck && versionCmd[i] == byteArray[vcmdPos - 4 + i];
      }

      if (versionPacketCheck) {
         if (vcmdPos + versionCmd[1] + crcLen < byteArray.length) {
            versionStruct = byteArray
               .slice(vcmdPos, vcmdPos + versionCmd[1])
               .toString();
            const crc = byteArray[vcmdPos + versionCmd[1]];

            if (!CheckCRC(versionStruct, crc)) {
               // TODO: handle these better
               console.warn(
                  'CRC did not match Caculated CRC for: ' +
                  versionCmd +
                  ' read command'
               );
            }
         }
      }
   } while (vcmdPos != -1);

   return versionStruct;
}

function getKeyByValue(object: any, value: any): any {
   return Object.keys(object).find(key => object[key] === value);
}

const deviceClassId = '06c878c2-9c56-11e8-98d0-529269fb1459';
//UUID generated using https://www.uuidgenerator.net/version1

function getDataFormat() {
   return ~~BlockDataFormat.k16BitBlockDataFormat; // For now!
}

const kMinOutBufferLenSamples = 32;

// the device supplies in units of beats per ten minutes and deci-mmHg, etc, hence the conversion factor of 10
const kConversionFactor = 10;
const kPressureRangeMaxMmHg = 300;
const kDecimalPlaces = 2;
const kBPMRangeMax = 200;
const IBIRangeMax = 2000;
const kCuffCountRange = 2;
const kCuffCountDownRange = 60;
const kQualRange = 10;
const kBeatsRange = 40;

function getDefaultUnits(chanType: number) {
   switch (chanType) {
      case NanoChannels.kBP:
         return new UnitsInfoImpl(
            'mmHg', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kPressureRangeMaxMmHg, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kPressureRangeMaxMmHg * kConversionFactor, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kPressureRangeMaxMmHg * kConversionFactor, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kHGT:
         return new UnitsInfoImpl(
            'mmHg', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kPressureRangeMaxMmHg, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kPressureRangeMaxMmHg * kConversionFactor, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kPressureRangeMaxMmHg * kConversionFactor, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kSYS:
         return new UnitsInfoImpl(
            'mmHg', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kPressureRangeMaxMmHg, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kPressureRangeMaxMmHg * kConversionFactor, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kPressureRangeMaxMmHg * kConversionFactor, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );
      case NanoChannels.kMAP:
         return new UnitsInfoImpl(
            'mmHg', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kPressureRangeMaxMmHg, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kPressureRangeMaxMmHg * kConversionFactor, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kPressureRangeMaxMmHg * kConversionFactor, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kDIA:
         return new UnitsInfoImpl(
            'mmHg', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kPressureRangeMaxMmHg, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kPressureRangeMaxMmHg * kConversionFactor, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kPressureRangeMaxMmHg * kConversionFactor, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kHR:
         return new UnitsInfoImpl(
            'bpm', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kBPMRangeMax, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kBPMRangeMax * kConversionFactor, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kBPMRangeMax * kConversionFactor, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kIBI:
         return new UnitsInfoImpl(
            'ms', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            IBIRangeMax, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            IBIRangeMax, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            IBIRangeMax, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kActiveCuff:
         return new UnitsInfoImpl(
            'CuffNum', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kCuffCountRange, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kCuffCountRange, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kCuffCountRange, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kCuffCountdown:
         return new UnitsInfoImpl(
            'MinutesLeft', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kCuffCountDownRange, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kCuffCountDownRange, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kCuffCountDownRange, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kQualLevel:
         return new UnitsInfoImpl(
            'QualLevel', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kQualRange, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kQualRange, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kQualRange, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      case NanoChannels.kAutoCalCountdown:
         return new UnitsInfoImpl(
            'BeatsLeft', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            kDecimalPlaces, //defaultDecPlaces
            kBeatsRange, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            kBeatsRange, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            kBeatsRange, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );

      default:
         return new UnitsInfoImpl(
            'V', //unit name
            UnitPrefix.kNoPrefix, //unit prefix
            2, //defaultDecPlaces
            32768, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
            32768, //maxInADCValues
            0, //minInPrefixedUnits
            0, //minInADCValues
            32678, //maxValidADCValue - affects the default drag scale range max
            0 //minValidADCValue - affects the default drag scale range min
         );
   }
}

enum CuffMode {
   UseCuff1 = 1, // Matches value hardware expects
   UseCuff2 = 2,
   SwitchCuffs = 3
}

type CuffSwitchInterval = 1 | 15 | 30 | 60;

/**
 * PhysicalDevice is a representation of the connected hardware device
 */
class PhysicalDevice implements OpenPhysicalDevice {
   deviceClass: DeviceClass;
   deviceConnection: DuplexDeviceConnection;
   typeName: string;
   numberOfChannels: number;
   parser: NanoParser;

   constructor(
      deviceClass: DeviceClass,
      deviceConnection: DuplexDeviceConnection,
      deviceName: string
   ) {
      this.deviceClass = deviceClass;
      this.deviceConnection = deviceConnection;

      this.typeName = 'Unknown Device';
      this.numberOfChannels = 11;
      this.processDeviceName(deviceName);

      this.onError = this.onError.bind(this);

      const inStream = new DuplexStream(this.deviceConnection);
      this.parser = new NanoParser(inStream, this.getDeviceName());
   }

   release() {
      if (this.deviceConnection) {
         this.deviceConnection.onStreamDestroy();
         this.deviceConnection.release();
      }
   }

   onError(err: Error) {
      console.error(err);
   }

   /**
    * @returns the name of the device
    */
   getDeviceName() {
      return this.deviceClass.getDeviceClassName() + ' : ' + this.typeName;
   }

   /**
    * @returns number of inputs on this device
    */
   getNumberOfAnalogInputs() {
      return this.numberOfChannels;
   }

   /**
    * @returns number of output streams on this device
    */
   getNumberOfAnalogStreams() {
      return this.numberOfChannels;
   }

   processDeviceName(deviceName: string) {
      this.typeName = deviceName;
   }

   getDescriptor(): OpenPhysicalDeviceDescriptor {
      return {
         deviceType: this.getDeviceName(),
         numInputs: this.getNumberOfAnalogInputs(),
         deviceId:
            this.deviceConnection.serialNumber ||
            this.deviceConnection.devicePath
      };
   }
}

class InputSettings {
   unitsInfo: UnitsInfo;
   range: any;

   setValues(other: IDeviceInputSettingsSys) {
      this.range.setValue(other.range);
   }

   constructor(
      proxy: ProxyDevice,
      streamIndex: number,
      inputIndex: number,
      streamSettings: StreamSettings,
      settingsData: IDeviceInputSettingsSys
   ) {
      this.unitsInfo = getDefaultUnits(streamIndex);

      //Gain range setting
      this.range = new Setting(
         settingsData.range,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(streamIndex, streamSettings, {
               //TODO:
               //unitsInfo: unitsFromPosFullScale(setting.value as number)
               unitsInfo: getDefaultUnits(inputIndex)
            });

            return newValue;
         }
      );
   }
}

class StreamSettings implements IDeviceStreamApiImpl {
   enabled: any;
   samplesPerSec: any;
   streamName: string;
   inputSettings: InputSettings;

   get isEnabled() {
      return !!this.enabled.value;
   }

   set isEnabled(enabled: boolean) {
      this.enabled.value = enabled;
   }

   setValues(other: IDeviceStreamApi) {
      this.enabled.setValue(other.enabled);
      this.samplesPerSec.setValue(other.samplesPerSec);
      this.inputSettings.setValues(other.inputSettings);
   }

   constructor(
      proxy: ProxyDevice,
      streamIndex: number,
      inputIndex: number,
      settingsData: IDeviceStreamApi
   ) {
      this.streamName = kStreamNames[streamIndex];
      this.enabled = new Setting(
         settingsData.enabled,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            return newValue;
         }
      );

      this.samplesPerSec = new Setting(
         settingsData.samplesPerSec,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(streamIndex, this, {});
            return newValue;
         }
      );
      this.inputSettings = new InputSettings(
         proxy,
         streamIndex,
         inputIndex,
         this,
         settingsData.inputSettings
      );
   }
}
class DeviceStreamConfigurationImpl {
   dataFormat: number;
   unitsInfo: UnitsInfo;

   constructor(streamIndex: number) {
      this.dataFormat = getDataFormat();
      this.unitsInfo = getDefaultUnits(streamIndex);
   }
}

export enum NanoTestTypes {
   SteadyPressure = 0x1, // Matches the value the hardware expects
   SquareWave = 0x2,
   SimulatePressure = 0x3,
   Default = SteadyPressure
}

const kSTX = 0xd4;
const crcLen = 1;

// CRC-8 Dallas/Maxim - x^8 + x^5 + x^4 + x^1
function calcCRC(payload: number[]) {
   let crc = 0 | 0;

   for (let chrCount = 0; chrCount < payload.length; ++chrCount) {
      let chr = payload[chrCount];

      for (let bitCount = 0; bitCount < 8; ++bitCount) {
         const mix = (chr ^ crc) & 1;

         crc >>= 1;
         chr >>= 1;

         if (mix) crc ^= 0x8c;
      }
   }

   return crc;
}

/**
 * Formats a write command ready to be sent to the device.
 *
 * @param cmdData The message payload data. See the accompanying NIBP protocol
 * firmware documentation:
 *
 * PRD1002-4-123_IDD Nano Core Communication Protocol Firmware v2.0.0.1678_1.0.pdf
 */
function nanoWriteMessage(cmdData: number[]) {
   const cmdWriteLen = cmdData.length;
   const crc = calcCRC(cmdData);

   // [kSTX, cmdWriteLEN, cmdWriteLEN, kSTX, cmdID, [cmd-data], [crc]]
   return new Uint8Array([
      kSTX,
      cmdWriteLen,
      cmdWriteLen,
      kSTX,
      ...cmdData,
      crc
   ]);
}

function code(char: string) {
   return char.charCodeAt(0);
}

function toBytesInt32(i32: number) {
   const arr = new ArrayBuffer(4); // an Int32 takes 4 bytes
   const view = new DataView(arr);
   view.setUint32(0, i32, false); // byteOffset = 0; litteEndian = false
   return new Uint8Array(arr);
}

// CRC-8 Dallas/Maxim - x^8 + x^5 + x^4 + x^1
function calcCRC2(payload: Uint8Array, start: number, end: number) {
   let crc = 0 | 0;

   for (let chrCount = start; chrCount < end; ++chrCount) {
      let chr = payload[chrCount];

      for (let bitCount = 0; bitCount < 8; ++bitCount) {
         const mix = (chr ^ crc) & 1;

         crc >>= 1;
         chr >>= 1;

         if (mix) crc ^= 0x8c;
      }
   }

   return crc;
}

const NanoTxSampCmds = Object.freeze({
   // [kSTX, cmdWriteLEN, cmdWriteLEN, kSTX, cmdID, [cmd-data], [crc]]
   // crc's have been pre-calculated for all send commands except switchIntervalCommand
   kAlive: new Uint8Array([kSTX, 0x01, 0x01, kSTX, 0x61, 0x3b]),

   switchIntervalCommand: (interval: CuffSwitchInterval) => {
      const message = new Uint8Array([
         kSTX,
         0x02,
         0x02,
         kSTX,
         0x63,
         (interval << 2) | 0x00, // interval in mins is at bits 2-7
         0
      ]);
      message[6] = calcCRC2(message, 4, 6);
      return message;
   },

   resetCuffScheduler: () => {
      const message = new Uint8Array([
         kSTX,
         0x02,
         0x02,
         kSTX,
         0x63,
         (0x3f << 2) | 0x00, // interval in mins is at bits 2-7
         0
      ]);
      message[6] = calcCRC2(message, 4, 6);
      return message;
   },

   kDisableCuffSwitching: nanoWriteMessage([code('c'), 0]),
   kUseCuffOne: nanoWriteMessage([code('c'), CuffMode.UseCuff1]),
   kUseCuffTwo: nanoWriteMessage([code('c'), CuffMode.UseCuff2]),

   kHCUZero: new Uint8Array([kSTX, 0x01, 0x01, kSTX, 0x7a, 0x86]),

   kDisablePhysioCal: new Uint8Array([
      kSTX,
      0x02,
      0x02,
      kSTX,
      0x68,
      0x00,
      0x2c
   ]),
   kEnablePhysioCal: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x68, 0x01, 0x72]),
   // TODO: not used atm
   kAskPhysioCalState: new Uint8Array([kSTX, 0x01, 0x01, kSTX, 0x68, 0xa7]),

   kStartMeasure: nanoWriteMessage([code('e'), 0x01]),
   kStopMeasure: nanoWriteMessage([code('e'), 0x02]),

   kEnterTestMode: nanoWriteMessage([code('e'), 0x03]),
   kExitTestMode: nanoWriteMessage([code('e'), 0x04]),

   startTest: (testType: NanoTestTypes, p0: number, p1: number, p2: number) =>
      nanoWriteMessage([
         code('t'),
         0x01,
         testType,
         ...toBytesInt32(p0),
         ...toBytesInt32(p1),
         ...toBytesInt32(p2)
      ])
});

const NanoRxSampCmds = Object.freeze({
   // [kSTX, cmdReadLEN, cmdReadLEN, kSTX, cmdID]
   kdataCmd: new Uint8Array([kSTX, 0x0a, 0x0a, kSTX, 0x64]),
   kbeatCmd: new Uint8Array([kSTX, 0x0f, 0x0f, kSTX, 0x62]),
   kstatusCmd: new Uint8Array([kSTX, 0x10, 0x10, kSTX, 0x73]),

   // TODO: untested and not used atm
   kHCUZeroingNCCmd: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x7a, 0x00]), // HCU not connected (NC)
   kHCUZeroingStartedCmd: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x7a, 0x04]) // HCU zeroing started
});

const NanoTxVersionCmds: FrozenObject<Uint8Array> = Object.freeze({
   // [kSTX, cmdWriteLEN, cmdWriteLEN, kSTX, cmdID, cmd-data, crc]
   kNanoHWVersion: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x76, 0x00, 0x1c]),
   kNanoAppVersion: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x76, 0x0a, 0x62]),
   kNanoBLVersion: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x76, 0x0b, 0x3c]),
   // [0x76, 0x0C] (Unified identification strings) isn't used atm because it has a varying length
   kNanoDeviceID: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x76, 0x0d, 0xe1])
});

type FrozenObject<T> = Readonly<{
   [key: string]: T;
}>;

const NanoRxVersionCmds: FrozenObject<Uint8Array> = Object.freeze({
   kHWVersionCmd: new Uint8Array([kSTX, 0x82, 0x82, kSTX, 0x76, 0x00]),
   kAppVersionCmd: new Uint8Array([kSTX, 0x82, 0x82, kSTX, 0x76, 0x0a]),
   kBLVersionCmd: new Uint8Array([kSTX, 0x82, 0x82, kSTX, 0x76, 0x0b]),
   // [0x76, 0x0C] (Unified identification strings) isn't used atm because it has a varying length
   kDeviceIDCmd: new Uint8Array([kSTX, 0x0e, 0x0e, kSTX, 0x76, 0x0d])
});

const NanoState = Object.freeze({
   kUnknown: -1,
   kStartingUp: 0,
   kIdle: 1,
   kMeasure: 3,
   kService: 4,
   kBootloader: 7,
   kError: 15
});

enum NanoHCUState {
   kHCUNotConnected,
   kHCUNotZeroed,
   kHCUZeroed,
   kHCUZeroUncertain,
   kHCUZeroingNow
}

enum NanoModes {
   Starting = 0,
   Idle = 1,
   Measure = 3,
   Service = 4,
   Bootloader = 7,
   Error = 15
}

// TODO: make warning strings nicer
const nanoWarningsArray: FrozenObject<string> = Object.freeze({
   0x00000000: 'NoWarning',
   0x00000001: 'GeneralWarning',
   0x00000004: 'PhysScan_warn_NewScanWithAHB',
   0x00000008: 'PhysAdju_warn_BeatUpTimeOut',
   0x00000010: 'PhysAdju_warn_BeatDownTimeOut',
   0x00000020: 'ManoBeDe_warn_PulseVeryLow',
   0x00000040: 'ManoBeDe_warn_NoPulse',
   0x00000080: 'SignInMo_warn_DecreasePletSp',
   0x00000100: 'OsciCont_warn_DecreasePletSp',
   0x00000200: 'PreContr_warn_BadStart',
   0x00000400: 'PreContr_warn_I2T_Protection',
   0x00000800: 'PreContr_warn_HighCurrent',
   0x00001000: 'PreContr_warn_PlungerPosEnd',
   0x00002000: 'PreContr_warn_TrackingError',
   0x00004000: 'PreContr_warn_PowerLimi',
   0x00008000: 'SysIntgr_warn_PressureSensorTrend',
   0x00010000: 'AppContr_warn_MeasurementLong',
   0x00020000: 'ModFlow_warn_BraCalLong',
   0x00040000: 'ModFlow_warn_BraCalLongAborted'
});

enum NanoChannels {
   kBP,
   kHGT,
   kSYS,
   kMAP,
   kDIA,
   kHR,
   kIBI,
   kActiveCuff,
   kCuffCountdown,
   kQualLevel,
   kAutoCalCountdown
}

/**
 * An object that handles parsing of data returned from the example device.
 * Note that this is device-specific and will need to be changed for any other device.
 */

class NanoParser {
   state: number;
   lastError = '';
   proxyDevice: ProxyDevice | null = null;
   inStream: IDuplexStream;
   deviceName: string;
   oldBytes: Buffer | null;
   oldBytesStartInd: number;
   beatPadSampleCount: number;
   statusPadSampleCount: number;
   lastSYSdata: number;
   lastMAPdata: number;
   lastDIAdata: number;
   lastHRdataBper10min: number;
   lastIBIdata: number;
   lastActiveCuffdata: number;
   lastCuffCountdowndata: number;
   lastAutoCalCountdowndata: number;

   lastHCUStatusdata: number;
   lastStatusError: number;
   lastStatusWarning: number;

   criticalError: boolean;
   raisedErrors: number[];
   raisedWarnings: string[];

   lastStatusMode: NanoModes;

   // autoCal is enabled by default
   physioCalEnabled: boolean;
   hcuStatusChanged: boolean;
   cuffSwitchingInterval: CuffSwitchInterval;

   constructor(inStream: IDuplexStream, deviceName: string) {
      this.state = NanoState.kUnknown;
      this.proxyDevice = null;
      this.inStream = inStream;
      this.deviceName = deviceName;

      // else it's utf-8 by default which causes write problems
      this.inStream.setDefaultEncoding('binary');

      this.onError = this.onError.bind(this);
      this.onData = this.onData.bind(this);

      this.oldBytes = null;
      this.oldBytesStartInd = 0;

      this.beatPadSampleCount = 0;
      this.statusPadSampleCount = 0;

      this.lastSYSdata = 0;
      this.lastMAPdata = 0;
      this.lastDIAdata = 0;
      this.lastHRdataBper10min = 0;
      this.lastIBIdata = 0;

      this.lastActiveCuffdata = 0;
      this.lastCuffCountdowndata = 0;
      this.lastAutoCalCountdowndata = 0;
      this.lastHCUStatusdata = -1;

      this.lastStatusError = 0;
      this.lastStatusWarning = 0;
      this.criticalError = false;
      this.raisedErrors = [];
      this.raisedWarnings = [];

      this.lastStatusMode = 0;

      // autoCal is enabled by default
      this.physioCalEnabled = true;

      this.hcuStatusChanged = false;

      this.cuffSwitchingInterval = kDefaultCuffSwitchingInterval;

      this.inStream.on('error', this.onError);
      this.inStream.on('data', this.onData);
   }

   /** Test mode API */

   enterModeIfNeeded(mode: NanoModes.Service | NanoModes.Measure) {
      if (this.lastStatusMode === mode) {
         return; // Already in the desired mode.
      }

      this.exitCurrentMode();

      switch (mode) {
         case NanoModes.Service:
            this.write(NanoTxSampCmds.kEnterTestMode);
            break;
         case NanoModes.Measure:
            // Default behaviour, nothing to do.
            break;
      }
   }

   startInCurrentMode(settings: INIBPSettings) {
      if (settings.sampleMode === NanoModes.Service) {
         this.startTest(settings);
      } else {
         this.write(NanoTxSampCmds.kStartMeasure);
      }
   }

   setTestModeEnabled(enabled: boolean) {
      this.enterModeIfNeeded(enabled ? NanoModes.Service : NanoModes.Measure);
   }

   startTest(settings: INIBPSettings) {
      const {
         testType,
         cuffMode,
         testSteadyPressure,
         testSquarePressureOffset,
         testSquareWaveFreq
      } = settings;

      const { lastActiveCuffdata } = this;

      const cuffSel =
         /*lastActiveCuffdata
         ? lastActiveCuffdata
         : */ cuffMode.asNumber;

      switch (testType.value) {
         case NanoTestTypes.SteadyPressure:
            this.write(
               NanoTxSampCmds.startTest(
                  testType.value,
                  cuffSel,
                  testSteadyPressure.asNumber,
                  0
               )
            );
            break;
         case NanoTestTypes.SquareWave: {
            const squareFreq = Math.max(
               1,
               Math.min(100, testSquareWaveFreq.asNumber)
            );
            const squarePeriod = 1000 / squareFreq;

            this.write(
               NanoTxSampCmds.startTest(
                  testType.asNumber,
                  cuffSel,
                  testSquarePressureOffset.asNumber,
                  squarePeriod
               )
            );
            break;
         }
         default:
            break;
      }
   }

   /**
    * Settings API
    */
   setAutocalibrationEnabled(enabled: boolean) {
      this.inStream.write(
         enabled
            ? NanoTxSampCmds.kEnablePhysioCal
            : NanoTxSampCmds.kDisablePhysioCal
      );
   }

   setCuffMode(mode: CuffMode) {
      this.write(NanoTxSampCmds.resetCuffScheduler());

      switch (mode) {
         case CuffMode.UseCuff1:
            this.write(NanoTxSampCmds.kUseCuffOne);
            break;
         case CuffMode.UseCuff2:
            this.write(NanoTxSampCmds.kUseCuffTwo);
            break;
         case CuffMode.SwitchCuffs:
            this.setCuffSwitchInterval(this.cuffSwitchingInterval);
            break;
         default:
            throw Error(`Setting cuff mode failed. Unknown mode: '${mode}'`);
      }
   }

   setCuffSwitchInterval(interval: CuffSwitchInterval) {
      this.cuffSwitchingInterval = interval;
      this.write(
         NanoTxSampCmds.switchIntervalCommand(this.cuffSwitchingInterval)
      );
   }

   isSampling() {
      return this.state == NanoState.kMeasure;
   }

   onError(err: Error) {
      this.lastError = err.message;
      console.error(err);
   }

   setProxyDevice(proxyDevice: ProxyDevice) {
      this.proxyDevice = proxyDevice;
   }

   write(chunk: Uint8Array) {
      // console.log('Send to nano:', chunk);
      this.inStream.write(chunk);
      // this.pendingWrites.push(chunk);
   }

   // pendingWrites: Uint8Array[] = [];

   // doWrite() {
   //    // console.log('Send to nano:', chunk);
   //    console.log(this.pendingWrites);
   //    this.pendingWrites.forEach(chunk => this.inStream.write(chunk));
   //    this.pendingWrites = [];
   // }

   exitCurrentMode() {
      switch (this.lastStatusMode) {
         case NanoModes.Measure:
            this.inStream.write(NanoTxSampCmds.kStopMeasure);
            break;
         case NanoModes.Service:
            this.inStream.write(NanoTxSampCmds.kExitTestMode);
            break;
         default:
            break;
      }
   }

   startSampling(settings: INIBPSettings) {
      if (!this.inStream || !this.proxyDevice) return false;

      settings.sendToHardware();

      // First stop doing whatever is currently happening unless we are already
      // "Ready"
      this.enterModeIfNeeded(settings.sampleMode);

      // TODO: remove, put somewhere more sensible
      this.state = NanoState.kMeasure;

      this.startInCurrentMode(settings);

      // Ignore any bytes stored from the previous sampling session.
      this.oldBytes = null;
      this.beatPadSampleCount = 0;
      this.statusPadSampleCount = 0;

      return true;
   }

   stopSampling() {
      // TODO: remove, put somewhere more sensible
      this.state = NanoState.kIdle;

      this.oldBytes = null;
      this.criticalError = false;
      this.raisedErrors = [];
      this.raisedWarnings = [];

      if (!this.inStream) return false;

      this.exitCurrentMode();

      if (this.proxyDevice)
         // Normal user stop
         this.proxyDevice.onSamplingStopped('');

      return true;
   }

   onData(newBytes: Buffer) {
      if (!newBytes.length) return;

      let oldBytes;
      switch (this.state) {
         case NanoState.kUnknown:
         case NanoState.kIdle:
            if (this.oldBytes == null) {
               oldBytes = newBytes;
            } else {
               oldBytes = concatTypedArrays(this.oldBytes, newBytes, 0);
            }

            this.processIdleData(oldBytes);

            // cuts off oldBytes prior to next data packet start
            oldBytes = oldBytes.slice(this.oldBytesStartInd, oldBytes.length);

            break;
         case NanoState.kMeasure:
            if (this.proxyDevice) this.proxyDevice.onSamplingStarted();

            // Keep writing alive to tell the nano to keep sampling
            setTimeout(() => {
               this.inStream.write(NanoTxSampCmds.kAlive);
            }, 500);

            if (this.oldBytes == null) {
               oldBytes = newBytes;
            } else {
               oldBytes = concatTypedArrays(this.oldBytes, newBytes, 0);
            }

            this.processMeasureData(oldBytes);

            // cuts off oldBytes prior to next data packet start
            oldBytes = oldBytes.slice(this.oldBytesStartInd, oldBytes.length);

            if (this.proxyDevice) this.proxyDevice.onSamplingUpdate();

            if (this.criticalError && this.proxyDevice) {
               // this.proxyDevice.stopSampling();
               break;
            }

            break;
         case NanoState.kError:
            console.error('Nano parser: error state');
            break;
         default:
            console.warn('Nano parser: unexpected state:', this.state);
      } //switch
      // this.doWrite();
   } //onData

   processIdleData(byteArray: Buffer) {
      this.oldBytesStartInd = 0;
      let scmdPos = 0;

      do {
         // look for most unique cmd byte after the last scmdPos
         scmdPos = byteArray.indexOf(NanoRxSampCmds.kstatusCmd[4], scmdPos + 1);

         let statusPacketCheck = true;
         for (let i = 0; i < NanoRxSampCmds.kstatusCmd.length; i++) {
            // iterate over the previous bytes to make sure it matches expected answer
            statusPacketCheck =
               statusPacketCheck &&
               NanoRxSampCmds.kstatusCmd[i] == byteArray[scmdPos - 4 + i];
         }

         // status packets with ActiveCuff, CuffCountdown and AutoCalCountdown data
         if (statusPacketCheck) {
            if (
               scmdPos + NanoRxSampCmds.kstatusCmd[1] + crcLen <
               byteArray.length
            ) {
               const statusPacket = byteArray.slice(
                  scmdPos,
                  scmdPos + NanoRxSampCmds.kstatusCmd[1]
               );
               const crc = byteArray[scmdPos + NanoRxSampCmds.kstatusCmd[1]];

               if (!CheckCRC(statusPacket, crc)) {
                  // TODO: handle these better
                  console.warn(
                     'CRC did not match Caculated CRC for: ' +
                     NanoRxSampCmds.kstatusCmd +
                     ' read command'
                  );
               }

               this.handleStatusFlags(byteArray, scmdPos);
            } else {
               // found cmd message, but it's chopped off before the end
               this.oldBytesStartInd = scmdPos;
            }
         }
      } while (scmdPos != -1);

      // TODO: handle NACKs and expected replies

      return;
   }

   processMeasureData(byteArray: Buffer) {
      if (!this.proxyDevice) {
         this.lastError =
            'Nano parser processMeasureData() called with no proxyDevice';
         console.error(this.lastError);
         return true;
      }

      this.oldBytesStartInd = 0;

      const outStreamBuffers = this.proxyDevice.outStreamBuffers;

      let dcmdPos = 0;
      let bcmdPos = 0;
      let scmdPos = 0;

      do {
         // look for most unique cmd byte after the last dcmdPos
         dcmdPos = byteArray.indexOf(NanoRxSampCmds.kdataCmd[4], dcmdPos + 1);

         let dataPacketCheck = true;
         for (let i = 0; i < NanoRxSampCmds.kdataCmd.length; i++) {
            // iterate over the previous bytes to make sure it matches expected answer
            dataPacketCheck =
               dataPacketCheck &&
               NanoRxSampCmds.kdataCmd[i] == byteArray[dcmdPos - 4 + i];
         }

         // data packets with BP, HGTand QualLevel (Physiocal) data
         if (dataPacketCheck) {
            if (
               dcmdPos + NanoRxSampCmds.kdataCmd[1] + crcLen <
               byteArray.length
            ) {
               const dataPacket = byteArray.slice(
                  dcmdPos,
                  dcmdPos + NanoRxSampCmds.kdataCmd[1]
               );
               const crc = byteArray[dcmdPos + NanoRxSampCmds.kdataCmd[1]];

               if (!CheckCRC(dataPacket, crc)) {
                  // TODO: handle these better
                  console.warn(
                     'CRC did not match Caculated CRC for: ' +
                     NanoRxSampCmds.kdataCmd +
                     ' read command'
                  );
               }

               this.beatPadSampleCount++;
               this.statusPadSampleCount++;

               //signed 16bit values, 1/10 mmHg
               let BPdataDecimmHg =
                  ((byteArray[dcmdPos + 4] & 0xff) << 8) |
                  (byteArray[dcmdPos + 3] & 0xff);
               const HGTdataDecimmHg =
                  ((byteArray[dcmdPos + 6] & 0xff) << 8) |
                  (byteArray[dcmdPos + 5] & 0xff);
               const Qualdata = byteArray[dcmdPos + 9] & 0x0f;

               // zerofies crufty pre-sampling nano-spew data at start of record
               if (BPdataDecimmHg > kPressureRangeMaxMmHg * 10)
                  BPdataDecimmHg = 0x8000;

               outStreamBuffers[NanoChannels.kBP].writeInt(BPdataDecimmHg);
               outStreamBuffers[NanoChannels.kHGT].writeInt(HGTdataDecimmHg);
               outStreamBuffers[NanoChannels.kQualLevel].writeInt(Qualdata);
            } else {
               // found cmd message, but it's chopped off before the end
               this.oldBytesStartInd = dcmdPos;
            }
         }

         // look for most unique cmd byte after the last bcmdPos
         bcmdPos = byteArray.indexOf(NanoRxSampCmds.kbeatCmd[4], bcmdPos + 1);

         let beatPacketCheck = true;
         for (let i = 0; i < NanoRxSampCmds.kbeatCmd.length; i++) {
            // iterate over the previous bytes to make sure it matches expected answer
            beatPacketCheck =
               beatPacketCheck &&
               NanoRxSampCmds.kbeatCmd[i] == byteArray[bcmdPos - 4 + i];
         }

         // beat_to_beat packets with Sys, Map, Dia, HR and IBI data
         if (beatPacketCheck) {
            if (
               bcmdPos + NanoRxSampCmds.kbeatCmd[1] + crcLen <
               byteArray.length
            ) {
               const beatPacket = byteArray.slice(
                  bcmdPos,
                  bcmdPos + NanoRxSampCmds.kbeatCmd[1]
               );
               const crc = byteArray[bcmdPos + NanoRxSampCmds.kbeatCmd[1]];

               if (!CheckCRC(beatPacket, crc)) {
                  // TODO: handle these better
                  console.warn(
                     'CRC did not match Caculated CRC for: ' +
                     NanoRxSampCmds.kbeatCmd +
                     ' read command'
                  );
               }

               this.lastSYSdata =
                  ((byteArray[bcmdPos + 5] & 0xff) << 8) |
                  (byteArray[bcmdPos + 4] & 0xff);
               this.lastMAPdata =
                  ((byteArray[bcmdPos + 7] & 0xff) << 8) |
                  (byteArray[bcmdPos + 6] & 0xff);
               this.lastDIAdata =
                  ((byteArray[bcmdPos + 9] & 0xff) << 8) |
                  (byteArray[bcmdPos + 8] & 0xff);
               this.lastHRdataBper10min =
                  ((byteArray[bcmdPos + 11] & 0xff) << 8) |
                  (byteArray[bcmdPos + 10] & 0xff);
               this.lastIBIdata =
                  ((byteArray[bcmdPos + 13] & 0xff) << 8) |
                  (byteArray[bcmdPos + 12] & 0xff);

               outStreamBuffers[NanoChannels.kSYS].writeInt(this.lastSYSdata);
               outStreamBuffers[NanoChannels.kMAP].writeInt(this.lastMAPdata);
               outStreamBuffers[NanoChannels.kDIA].writeInt(this.lastDIAdata);
               outStreamBuffers[NanoChannels.kHR].writeInt(
                  this.lastHRdataBper10min
               );
               outStreamBuffers[NanoChannels.kIBI].writeInt(this.lastIBIdata);
            } else {
               // found cmd message, but it's chopped off before the end
               this.oldBytesStartInd = bcmdPos;
            }
            this.beatPadSampleCount--;
         }

         // look for most unique cmd byte after the last scmdPos
         scmdPos = byteArray.indexOf(NanoRxSampCmds.kstatusCmd[4], scmdPos + 1);

         let statusPacketCheck = true;
         for (let i = 0; i < NanoRxSampCmds.kstatusCmd.length; i++) {
            // iterate over the previous bytes to make sure it matches expected answer
            statusPacketCheck =
               statusPacketCheck &&
               NanoRxSampCmds.kstatusCmd[i] == byteArray[scmdPos - 4 + i];
         }

         // status packets with ActiveCuff, CuffCountdown and AutoCalCountdown data
         if (statusPacketCheck) {
            if (
               scmdPos + NanoRxSampCmds.kstatusCmd[1] + crcLen <
               byteArray.length
            ) {
               const statusPacket = byteArray.slice(
                  scmdPos,
                  scmdPos + NanoRxSampCmds.kstatusCmd[1]
               );
               const crc = byteArray[scmdPos + NanoRxSampCmds.kstatusCmd[1]];

               if (!CheckCRC(statusPacket, crc)) {
                  // TODO: handle these better
                  console.warn(
                     'CRC did not match Caculated CRC for: ' +
                     NanoRxSampCmds.kstatusCmd +
                     ' read command'
                  );
               }

               this.handleStatusFlags(byteArray, scmdPos);

               this.lastActiveCuffdata = byteArray[scmdPos + 10] & 0x03;
               this.lastCuffCountdowndata = byteArray[scmdPos + 10] & 0xfc;
               this.lastAutoCalCountdowndata = byteArray[scmdPos + 12];

               // zerofies crufty pre-sampling nano-spew data at start of record
               // default appears to be 62 minutes
               if (this.lastCuffCountdowndata > 61)
                  this.lastCuffCountdowndata = 0;

               outStreamBuffers[NanoChannels.kActiveCuff].writeInt(
                  this.lastActiveCuffdata
               );
               outStreamBuffers[NanoChannels.kCuffCountdown].writeInt(
                  this.lastCuffCountdowndata
               );
               outStreamBuffers[NanoChannels.kAutoCalCountdown].writeInt(
                  this.lastAutoCalCountdowndata
               );
            } else {
               // found cmd message, but it's chopped off before the end
               this.oldBytesStartInd = scmdPos;
            }
            this.statusPadSampleCount--;
         }
      } while (dcmdPos != -1);

      // Upsample beat data to BP data
      for (
         this.beatPadSampleCount;
         this.beatPadSampleCount > 0;
         this.beatPadSampleCount--
      ) {
         outStreamBuffers[NanoChannels.kSYS].writeInt(this.lastSYSdata);
         outStreamBuffers[NanoChannels.kMAP].writeInt(this.lastMAPdata);
         outStreamBuffers[NanoChannels.kDIA].writeInt(this.lastDIAdata);
         outStreamBuffers[NanoChannels.kHR].writeInt(this.lastHRdataBper10min);
         outStreamBuffers[NanoChannels.kIBI].writeInt(this.lastIBIdata);
      }

      // Upsample status data to BP data
      for (
         this.statusPadSampleCount;
         this.statusPadSampleCount > 0;
         this.statusPadSampleCount--
      ) {
         outStreamBuffers[NanoChannels.kActiveCuff].writeInt(
            this.lastActiveCuffdata
         );
         outStreamBuffers[NanoChannels.kCuffCountdown].writeInt(
            this.lastCuffCountdowndata
         );
         outStreamBuffers[NanoChannels.kAutoCalCountdown].writeInt(
            this.lastAutoCalCountdowndata
         );
      }

      return;
   }

   handleStatusFlags(byteArray: Buffer, scmdPos: number) {
      const statusPacket = byteArray.slice(
         scmdPos,
         scmdPos + NanoRxSampCmds.kstatusCmd[1]
      );
      const crc = byteArray[scmdPos + NanoRxSampCmds.kstatusCmd[1]];

      if (!CheckCRC(statusPacket, crc)) {
         // TODO: handle these better
         console.warn(
            'CRC did not match Caculated CRC for: ' +
            NanoRxSampCmds.kstatusCmd +
            ' read command'
         );
      }

      this.lastStatusWarning = byteArray[scmdPos + 5] & 0xff;
      this.lastStatusWarning |= (byteArray[scmdPos + 6] & 0xff) << 8;
      this.lastStatusWarning |= (byteArray[scmdPos + 7] & 0xff) << 16;
      this.lastStatusWarning |= (byteArray[scmdPos + 8] & 0xff) << 24;

      this.lastStatusError = byteArray[scmdPos + 4] & 0x7f;

      this.lastStatusMode = (byteArray[scmdPos + 3] & 0xf0) >> 4;

      if (this.lastHCUStatusdata != (byteArray[scmdPos + 9] & 0xe0) >> 5) {
         if (
            (byteArray[scmdPos + 9] & 0xe0) >> 5 !==
            NanoHCUState.kHCUZeroingNow
         ) {
            this.lastHCUStatusdata = (byteArray[scmdPos + 9] & 0xe0) >> 5;
         }

         this.reportHCUStatus();
      }

      if (
         this.lastStatusError != 0 &&
         !this.raisedErrors.includes(this.lastStatusError)
      ) {
         console.error(
            this.deviceName + ' - ' + nanoErrorArray[this.lastStatusError][1]
         );
         this.criticalError = true;
         this.raisedErrors.push(this.lastStatusError);
      }

      if (this.lastStatusMode != this.state) {
         // TODO: figure out how to use this more sensibly
         // this.state = this.lastStatusMode;
      }

      if (
         this.lastStatusMode == NanoModes.Error &&
         !this.raisedErrors.includes(this.lastStatusMode)
      ) {
         console.error(this.deviceName + ' - ' + 'Error mode');
         this.criticalError = true;
         this.raisedErrors.push(this.lastStatusMode);
      }

      if (this.lastStatusWarning != 0) {
         for (const nanoWarningCode in nanoWarningsArray) {
            if (
               (this.lastStatusWarning & parseInt(nanoWarningCode, 10)) != 0 &&
               !this.raisedWarnings.includes(nanoWarningCode)
            ) {
               // promote this particular warning to an error because of it's severity
               if (
                  nanoWarningCode ==
                  getKeyByValue(nanoWarningsArray, 'ManoBeDe_warn_NoPulse')
               ) {
                  console.error(
                     this.deviceName +
                     ' - ' +
                     nanoWarningsArray[nanoWarningCode]
                  );
                  this.criticalError = true;
               } else {
                  console.warn(
                     this.deviceName +
                     ' - ' +
                     nanoWarningsArray[nanoWarningCode]
                  );
               }
               this.raisedWarnings.push(nanoWarningCode);
            }
         }
      }
   }

   private hcuZeroCallback?: (
      error: Error | null,
      result: { hcuStatus: string }
   ) => void;

   setHCUZeroCallback(
      callback: (error: Error | null, result: { hcuStatus: string }) => void
   ) {
      this.hcuZeroCallback = callback;

      // We may not get an HCU status response from the device in rare cases.
      // Ensure the UI doesn't spin forever by invoking the done callback.
      const kHCUZeroTimeoutMs = 5000;

      setTimeout(() => {
         this.hcuZeroCallback &&
            this.hcuZeroCallback(null, {
               hcuStatus: 'HCU zero timed out. Try again.'
            });
      }, kHCUZeroTimeoutMs);
   }

   reportHCUStatus() {
      this.hcuStatusChanged = false;

      let hcuStatus = 'Unknown HCU Status.';

      switch (this.lastHCUStatusdata) {
         case NanoHCUState.kHCUNotConnected:
            hcuStatus = 'HCU not connected.';
            break;
         case NanoHCUState.kHCUNotZeroed:
            hcuStatus = 'HCU not zeroed.';
            break;
         case NanoHCUState.kHCUZeroed:
            hcuStatus = 'HCU zeroed.';
            break;
         case NanoHCUState.kHCUZeroUncertain:
            hcuStatus = 'HCU zeroing uncertain. Try again.';
            break;
         case NanoHCUState.kHCUZeroingNow:
            hcuStatus = 'HCU zeroing at the moment.';
            break;
         default:
            hcuStatus = 'Unknown HCU Status.';
            break;
      }

      this.hcuZeroCallback &&
         this.hcuZeroCallback(null, {
            hcuStatus
         });
   }
} //NanoParser

interface INIBPSettings extends IDeviceProxySettingsSys {
   sampleMode: NanoModes.Service | NanoModes.Measure;

   testMode: Setting;
   testType: Setting;

   // Steady pressure options
   testSteadyPressure: Setting;

   // Square wave options
   testSquarePressureOffset: Setting;
   testSquareWaveFreq: Setting;

   autoCalibrate: Setting;
   cuffMode: Setting;
   cuffSwitchingInterval: Setting;

   hcuZero(
      argJson: {},
      callback: (
         error: Error | null,
         result: { hcuStatus: string } | null
      ) => void
   ): void;
}

export class NIBPSettings implements INIBPSettings {
   private static kSettingsVersion = 1;

   version = NIBPSettings.kSettingsVersion;
   dataInStreams: IDeviceStreamApi[] = [];

   get sampleMode(): NanoModes.Service | NanoModes.Measure {
      return this.testMode.value ? NanoModes.Service : NanoModes.Measure;
   }

   testMode: Setting;
   testType: Setting;
   testSteadyPressure: Setting;
   testSquarePressureOffset: Setting;
   testSquareWaveFreq: Setting;

   autoCalibrate: Setting;
   cuffMode: Setting;
   cuffSwitchingInterval: Setting;

   private doHcuZero = (parser: NanoParser | null) => (
      argJson: {},
      callback: (
         error: Error | null,
         result: { hcuStatus: string } | null
      ) => void
   ): void => {
      if (parser) {
         // When the zero process finishes, allow the parser to invoke our done callback.
         parser.setHCUZeroCallback(callback);

         parser.inStream.write(NanoTxSampCmds.kHCUZero);
      } else {
         callback(
            new Error(
               "HCU can not be zero'd before connecting to the physical device"
            ),
            null
         );
      }
   };

   assign(settingsData: NIBPSettings) {
      this.testMode.setValue(settingsData.testMode);
      this.testType.setValue(settingsData.testType);
      this.testSteadyPressure.setValue(settingsData.testSteadyPressure);
      this.testSquarePressureOffset.setValue(
         settingsData.testSquarePressureOffset
      );
      this.testSquareWaveFreq.setValue(settingsData.testSquareWaveFreq);

      this.autoCalibrate.setValue(settingsData.autoCalibrate);
      this.cuffMode.setValue(settingsData.cuffMode);
      this.cuffSwitchingInterval.setValue(settingsData.cuffSwitchingInterval);
   }

   sendToHardware() {
      this.testMode.sendToHardware();
      this.testType.sendToHardware();
      this.testSteadyPressure.sendToHardware();
      this.testSquarePressureOffset.sendToHardware();
      this.testSquareWaveFreq.sendToHardware();

      this.autoCalibrate.sendToHardware();

      switch (this.cuffMode.asNumber) {
         case CuffMode.UseCuff1:
         case CuffMode.UseCuff2:
            this.cuffMode.sendToHardware();
            break;
         default:
            this.cuffSwitchingInterval.sendToHardware();
            break;
      }
   }

   // Called when a physical device becomes available for use in the recording.
   onPhysicalDeviceConnected(parser: NanoParser) {
      this.hcuZero = this.doHcuZero(parser);

      this.sendToHardware();
   }

   private static defaultEnabled = {
      settingName: 'Enabled',
      value: true,
      options: [
         {
            value: true,
            display: new Boolean(true).toString()
         },
         {
            value: false,
            display: new Boolean(false).toString()
         }
      ]
   };

   private static defaultRate = {
      settingName: 'Rate',
      value: kSupportedSamplesPerSec[kDefaultSamplesPerSecIndex],
      options: [
         {
            value: kSupportedSamplesPerSec[0],
            display: kSupportedSamplesPerSec[0].toString() + ' Hz'
         }
      ]
   };

   private static defaultInputSettings = (index: number) => {
      const defaultUnits = getDefaultUnits(index);
      const defaultRange = defaultUnits.maxInPrefixedUnits;
      return {
         range: {
            settingName: 'Range',
            value: defaultRange,
            options: [
               {
                  value: defaultRange,
                  display: defaultRange.toString() + ' ' + defaultUnits.unitName
               }
            ]
         }
      };
   };

   hcuZero: (
      argJson: {},
      callback: (
         error: Error | null,
         result: { hcuStatus: string } | null
      ) => void
   ) => void;

   protected constructor(proxy: ProxyDevice) {
      this.hcuZero = this.doHcuZero(proxy.parser);

      this.dataInStreams = Object.keys(NanoChannels).map((key, index) => ({
         enabled: NIBPSettings.defaultEnabled,
         samplesPerSec: NIBPSettings.defaultRate,
         inputSettings: NIBPSettings.defaultInputSettings(index)
      }));

      this.testMode = new Setting(
         {
            options: [],
            settingName: 'Test mode',
            value: false
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            if (proxy.parser) {
               proxy.parser.setTestModeEnabled(!!newValue);
            }

            return newValue;
         }
      );

      this.testType = new Setting(
         {
            settingName: 'Test type',
            value: NanoTestTypes.Default,
            options: [
               {
                  value: NanoTestTypes.SquareWave,
                  display: 'Square wave'
               },
               {
                  value: NanoTestTypes.SteadyPressure,
                  display: 'Steady pressure'
               },
               {
                  value: NanoTestTypes.SimulatePressure,
                  display: 'Simulate pressure'
               }
            ]
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            return newValue;
         }
      );
      this.testSteadyPressure = new Setting(
         {
            settingName: 'Steady pressure',
            value: 50,
            options: [
               {
                  value: 50,
                  display: '50 mmHg'
               },
               {
                  value: 100,
                  display: '100 mmHg'
               },
               {
                  value: 150,
                  display: '150 mmHg'
               },
               {
                  value: 200,
                  display: '200 mmHg'
               },
               {
                  value: 250,
                  display: '250 mmHg'
               },
               {
                  value: 300,
                  display: '300 mmHg'
               }
            ]
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            return newValue;
         }
      );
      this.testSquarePressureOffset = new Setting(
         {
            settingName: 'Pressure offset',
            value: 50,
            options: [
               {
                  value: 50,
                  display: '50 mmHg'
               },
               {
                  value: 100,
                  display: '100 mmHg'
               },
               {
                  value: 150,
                  display: '150 mmHg'
               },
               {
                  value: 200,
                  display: '200 mmHg'
               },
               {
                  value: 250,
                  display: '250 mmHg'
               }
            ]
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            return newValue;
         }
      );
      this.testSquareWaveFreq = new Setting(
         {
            settingName: 'Square wave frequency',
            value: 1,
            options: [
               {
                  value: 1,
                  display: '1 Hz'
               },
               {
                  value: 4,
                  display: '4 Hz'
               },
               {
                  value: 10,
                  display: '10 Hz'
               }
            ]
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            return newValue;
         }
      );

      this.autoCalibrate = new Setting(
         {
            options: [],
            settingName: 'Auto calibration',
            value: true
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            if (proxy.parser) {
               proxy.parser.setAutocalibrationEnabled(!!newValue);
            }

            return newValue;
         }
      );

      this.cuffMode = new Setting(
         {
            settingName: 'Cuff-mode',
            value: CuffMode.UseCuff1,
            options: [
               {
                  value: CuffMode.UseCuff1,
                  display: 'Cuff 1 (C1)'
               },
               {
                  value: CuffMode.UseCuff2,
                  display: 'Cuff 2 (C2)'
               },
               {
                  value: CuffMode.SwitchCuffs,
                  display: 'Switch cuffs'
               }
            ]
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            if (proxy.parser) {
               proxy.parser.setCuffMode(newValue as CuffMode);
            }

            return newValue;
         }
      );

      this.cuffSwitchingInterval = new Setting(
         {
            settingName: 'Switching interval',
            value: kDefaultCuffSwitchingInterval,
            options: [
               {
                  value: 1,
                  display: '1 minute'
               },
               {
                  value: 15,
                  display: '15 minutes'
               },
               {
                  value: 30,
                  display: '30 minutes'
               },
               {
                  value: 60,
                  display: '1 hour'
               }
            ]
         },
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            if (proxy.parser) {
               proxy.parser.setCuffSwitchInterval(
                  newValue as CuffSwitchInterval
               );
            }

            return newValue;
         }
      );
   }

   static defaults(proxy: ProxyDevice): NIBPSettings {
      return new NIBPSettings(proxy);
   }
}

/**
 * The ProxyDevice object is created for each recording. Manages hardware settings and sampling.
 */
class ProxyDevice implements IProxyDevice {
   settings: NIBPSettings;
   outStreamBuffers: StreamRingBuffer[];
   proxyDeviceSys: ProxyDeviceSys | null;
   physicalDevice: PhysicalDevice | null;
   parser: NanoParser | null; //Only non-null if this proxy is the one with a lock on the PhysicalDevice
   lastError: Error | null;
   settingsFromLoad: INIBPSettings;

   /**
    * @returns if the device is sampling
    */
   get isSampling() {
      // Need to reset this even if sampling stops because the device went bad
      return this.parser ? this.parser.isSampling() : false;
   }

   // Pass null for PhysicalDevice when proxy created in absence of hardware
   constructor(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: PhysicalDevice | null,
      settings?: INIBPSettings
   ) {
      /**
       * outStreamBuffers
       *
       * After sampled data has been parsed, it needs to be written to these buffers.
       * There is a buffer for each device stream
       */

      this.outStreamBuffers = [];
      this.proxyDeviceSys = quarkProxy;
      this.physicalDevice = physicalDevice;
      this.parser = null; //Only non-null if this proxy is the one with a lock on the PhysicalDevice
      this.lastError = null;

      this.onError = this.onError.bind(this);

      const nStreams = physicalDevice
         ? physicalDevice.getNumberOfAnalogStreams()
         : 0;

      this.initializeSettings(
         nStreams,
         settings || NIBPSettings.defaults(this)
      );
   }

   clone(quarkProxy: ProxyDeviceSys) {
      return new ProxyDevice(quarkProxy, this.physicalDevice, this.settings);
   }

   release() {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.release();
      }
   }

   onError(err: Error) {
      this.lastError = err;
      console.error(err);
   }

   /**
    * Called for both new and existing recordings. Initialize all settings for this device that are
    * to be saved in the recording.
    *
    * @param nStreams The number of default streams to initialize for.
    */
   initializeSettings(nStreams: number, settingsData: INIBPSettings) {
      this.settings = NIBPSettings.defaults(this);
      this.settings.dataInStreams = [];
      this.settings.assign(settingsData as NIBPSettings);

      const defaultSettings = NIBPSettings.defaults(this);

      for (let streamIndex = 0; streamIndex < nStreams; ++streamIndex) {
         const defaultStreamSettingsData =
            defaultSettings.dataInStreams[streamIndex];

         const streamSettingsData = settingsData.dataInStreams[streamIndex];
         //If multiple streams share the hardware input they should reference the same InputSettings object
         const inputIndex = streamIndex; //Default to 1 to 1
         const streamSettings = new StreamSettings(
            this,
            streamIndex,
            inputIndex,
            defaultStreamSettingsData
         );

         //Assign values not (old) options!
         streamSettings.setValues(streamSettingsData);

         this.settings.dataInStreams.push(streamSettings);
         this.updateStreamSettings(
            streamIndex,
            streamSettings,
            new DeviceStreamConfigurationImpl(streamIndex)
         );
      }
   }

   updateStreamSettings(
      streamIndex: number,
      streamSettings: StreamSettings,
      config: Partial<IDeviceStreamConfiguration>
   ) {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.setupDataInStream(
            streamIndex,
            streamSettings,
            config,
            this.applyStreamSettingsToHW(streamIndex)
         );
      }
   }

   //TODO: pass the actual setting that changed
   //Note this is a curried function so it can be called by Quark on the main JS thread after sampling has stopped, if needed.
   applyStreamSettingsToHW(streamIndex: number) {
      return (error: Error | null, type: any) => {
         if (error) console.error(error);
         else if (type === SysStreamEventType.kApplyStreamSettingsToHardware) {
            //TODO: replace this console log with actually sending appropriate command(s) to the hardware
            console.log(
               'Apply stream settings to hardware for stream',
               streamIndex
            );
         }
      };
   }

   getOutBufferInputIndices() {
      const result = new Int32Array(this.outStreamBuffers.length);
      let i = 0;
      for (const buf of this.outStreamBuffers) {
         result[i++] = buf.inIndex;
      }
      return result;
   }

   setOutBufferOutputIndices(indices: Int32Array) {
      if (indices.length != this.outStreamBuffers.length)
         throw Error(
            'Expected number of indices to equal number of outStreamBuffers'
         );
      let i = 0;
      for (const buf of this.outStreamBuffers) {
         buf.outIndex = indices[i++];
      }
   }

   /**
    * Called from Quark when re-opening an existing recording to set the physical device
    * on this proxy (which can be read from disk), or when the user chooses to use a different device
    * (of the same class) with this proxy (i.e. settings).
    *
    * @param physicalDevice the new PhysicalDevice that is in use
    * @returns whether the operation succeeded
    */
   setPhysicalDevice(physicalDevice: OpenPhysicalDevice) {
      this.physicalDevice = physicalDevice as PhysicalDevice;

      if (this.parser === null) {
         this.connectToPhysicalDevice();
      }

      // If the hardware capabilities have changed, this is where the process
      // to translate from existing settings is performed.
      // Where hardware capabilities are reduced, the existing settings should
      // be left alone (in case original hardware comes back in future).
      // e.g. set hwSupport = false on the relevant setting.

      // Create the settings structure, copying our saved settings info into it.
      this.initializeSettings(
         this.settingsFromLoad.dataInStreams.length,
         this.settingsFromLoad
      );

      return true;
   }

   /**
    * Called from Quark when re-opening an existing recording to restore the
    * settings.
    *
    * @param settings is the settings saved in the recording for this device.
    * @returns whether the operation succeeded.
    */
   setSettings(settings: INIBPSettings) {
      this.settingsFromLoad = settings;

      // Create the settings structure, copying our saved settings info into it.
      this.initializeSettings(settings.dataInStreams.length, settings);

      return true;
   }

   /**
    * Called from Quark when user sets recording rate in single-rate mode.
    * If possible, set all this proxy's streams to closest possible rate <= samplesPerSec.
    */
   setAllChannelsSamplesPerSec(samplesPerSec: number) {
      // This is bad! Might allow corruption of a device that another recording is using!
      // if (this.parser === null) {
      //    this.connectToPhysicalDevice();
      // }

      for (const stream of this.settings.dataInStreams) {
         stream.samplesPerSec.value = findClosestSupportedRate(samplesPerSec);
      }

      return true;
   }

   /**
    * Called from Quark to get the last error detected by the proxy
    *
    * @returns the last error as a string
    */
   getLastError() {
      return this.lastError ? this.lastError.message : '';
   }

   /**
    * Called from Quark. Only returns device name if proxy has
    * access to PhysicalDevice
    *
    * @returns device name
    */
   getDeviceName() {
      if (this.physicalDevice) return this.physicalDevice.getDeviceName();
      return 'no device';
   }

   /**
    * Devices have hardware inputs and software outputs which we call streams.
    * There is not always a one to one mapping between these. Lightning maps streams
    * onto channels in a recording.
    *
    * @returns the number of output streams for this device
    */
   getNumberOfAnalogStreams() {
      return this.settings.dataInStreams.length;
   }

   /**
    * Called from Quark to allow this proxy to communicate with the device
    *
    * @returns if operation succeeded
    */
   connectToPhysicalDevice() {
      if (this.parser) {
         console.warn('connectToPhysicalDevice: already connected!');
         return true;
      }

      if (this.physicalDevice) {
         this.parser = this.physicalDevice.parser;
         this.settings.onPhysicalDeviceConnected(this.parser);
         return true;
      }
      this.lastError = new Error('physical device missing');
      return false;
   }

   /**
    * Called from Quark to prevent multiple proxies trying to communicate with the device at the same time.
    */
   disconnectFromPhysicalDevice() {
      this.parser = null; // Drop our reference to the parser in the PhysicalDevice
   }

   /**
    * @param bufferSizeInSecs should be used to calculate the size in samples of the ring buffers allocated
    * for each output stream. Quark guarantees to remove samples from these buffers well before they
    * become full if they are of this length.
    *
    * @returns if the operation succeeded. If this returns false, the calling code could call getLastError()
    * to find out what's wrong.
    */
   prepareForSampling(bufferSizeInSecs: number) {
      if (!this.parser || !this.physicalDevice) return false; // Can't sample if no hardware connection

      // Show user a warning, allowing them to cancel sampling.
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStartSamplingUserQuery,
            'Human NIBP Nano',
            'Sampling will inflate finger cuffs. They can be damaged if inflated while empty.',
            {
               onceOnly: 'check-finger-cuffs',
               severity: TMessageSeverity.kMessageWarn
            }
         );
      }

      // Create Array of StreamBuffers (each with a streamIndex property) for
      // each enabled stream.
      this.outStreamBuffers = [];
      let index = 0;
      for (const stream of this.settings.dataInStreams) {
         if (stream && stream.isEnabled) {
            const nSamples = Math.max(
               bufferSizeInSecs *
               ((stream.samplesPerSec as IDeviceSetting).value as number),
               kMinOutBufferLenSamples
            );
            this.outStreamBuffers.push(
               new StreamRingBufferImpl(index, nSamples)
            );
         }
         ++index;
      }

      //Set this proxy device as the sampling proxy
      this.parser.setProxyDevice(this);

      return true;
   }

   /**
    * Called from Quark. Device command to start sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStarted) needs to be called on the ProxyDeviceSys
    *
    * @returns if device successfully started to sample
    */
   startSampling() {
      if (!this.parser) return false; // Can't sample if no hardware connection

      return this.parser.startSampling(this.settings);
   }

   /**
    * Called from Quark. Device command to stop sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStopped) needs to be called on the ProxyDeviceSys
    *
    * @returns if device successfully stopped sampling
    */
   stopSampling() {
      if (!this.parser) return false; // Can't sample if no hardware connection
      return this.parser.stopSampling();
   }

   /**
    * Called from Quark after sampling has finished. The outStreamBuffers should be reset here.
    *
    * @returns if cleanup succeeded
    */
   //If this returns false, the calling code could call getLastError() to find out what's wrong
   cleanupAfterSampling() {
      this.outStreamBuffers = [];
      return true;
   }

   onSamplingStarted() {
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStarted,
            this.getDeviceName()
         );
   }

   onSamplingStopped(errorMsg?: string) {
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStopped,
            this.getDeviceName(),
            errorMsg
         );
   }

   /**
    * ProxyDeviceSys needs to be notified when samples are parsed and written to the outStreamBuffers.
    * This is done by calling samplingUpdate(inOutIndices) on the ProxyDeviceSys, where inOutIndices is
    * an array of the write pointers in the outStreamBuffers.
    */
   onSamplingUpdate() {
      if (this.proxyDeviceSys) {
         const inOutIndices = this.getOutBufferInputIndices();
         this.proxyDeviceSys.samplingUpdate(inOutIndices);
         this.setOutBufferOutputIndices(inOutIndices);
      }
   }
}

/**
 * The device class is the set of types of device that can share the same settings so that
 * when a recording is re-opened, Quark will try to match device proxies read from disk to
 * available physical devices on a "best fit" match of capabilies.
 * The DeviceClass object represents this set of devices and can find and create PhysicalDevice
 * objects of its class, as well as the ProxyDevice objects.
 */
class DeviceClass implements IDeviceClass {
   versionInfoArray: string[];

   // While worker support for devices is in development.
   runOnMainThread = true;

   constructor() {
      this.checkDeviceIsPresent = this.checkDeviceIsPresent.bind(this);
      this.versionInfoArray = [];
   }

   onError(err: Error) {
      console.error(err);
   }

   /**
    * Optional method for testing only!
    */
   clearPhysicalDevices(): void {
      //this.physicalDevices = [];
   }

   /**
    * Called when the app shuts down. Chance to release any resources acquired during this object's
    * life.
    */
   release() { }

   /**
    * @returns the name of the class of devices
    */
   getDeviceClassName() {
      return 'NIBPSerialDevice';
   }

   /**
    * @returns a GUID to identify this object
    */
   getClassId() {
      return deviceClassId;
   }

   /**
    * @returns a TDeviceConnectionType that defines the connection type.
    * ie. USB, serial etc.
    */
   getDeviceConnectionType() {
      return TDeviceConnectionType.kDevConTypeSerialPort;
   }

   // This is the method that will be called when integration tests are running.
   getDeviceConnectionTypeTEST() {
      return TDeviceConnectionType.kDevConTypeMockSerialPortForTesting;
   }

   makePhysicalDevice(
      deviceConnection: DuplexDeviceConnection,
      versionInfo: string
   ) {
      return new PhysicalDevice(this, deviceConnection, versionInfo);
   }

   // This is the method that will be called when integration tests are running.
   checkDeviceIsPresentTEST(
      deviceConnection: DuplexDeviceConnection,
      callback: (error: Error | null, device: OpenPhysicalDevice | null) => void
   ): void {
      const physicalDevice = new PhysicalDevice(
         this,
         deviceConnection,
         'Fake NIBP Nano'
      );
      callback(null, physicalDevice);
   }

   /**
    * This is called by Lightning when enumerating connections while searching for devices.
    *
    * @param deviceConnection An object which contains information about the connection,
    * and allows communication with the device.
    *
    * @param callback When finished, callback must be called with the PhysicalDevice object if
    * successfully identified. Any errors are passed through as well.
    */
   checkDeviceIsPresent(
      deviceConnection: DuplexDeviceConnection,
      callback: (error: Error | null, device: PhysicalDevice | null) => void
   ) {
      const vid = deviceConnection.vendorId.toUpperCase();
      const pid = deviceConnection.productId.toUpperCase();

      if (
         vid !== '0403' ||
         pid !== '6001' ||
         deviceConnection.manufacturer !== 'FTDI'
      ) {
         // Did not find one of our devices on this connection
         callback(null, null);
         return;
      }

      // Give up if device is not detected within the timeout period or number of retries
      const kTimeoutms = 3000; // Time for device to reboot and respond

      deviceConnection.setOption({ baud_rate: 115200 });

      const devStream = new DuplexStream(deviceConnection);

      // else it's utf-8 by default which causes write problems
      devStream.setDefaultEncoding('binary');

      // Give up if device is not detected within the timeout period
      devStream.setReadTimeout(kTimeoutms);

      const versionCmdKey = Object.keys(NanoTxVersionCmds)[
         this.versionInfoArray.length
      ];
      devStream.write(NanoTxVersionCmds[versionCmdKey]);

      let oldBytes = null;

      // connect data handler
      devStream.on('data', newBytes => {
         oldBytes = newBytes;

         const versStruct = findVersionData(
            oldBytes,
            this.versionInfoArray.length
         );

         // TODO: convert versionInfoArray structs into a meaningful form
         if (versStruct.length > 0) this.versionInfoArray.push(versStruct);

         // this iterates through the version commands and constructs a versionInfoArray
         if (this.versionInfoArray.length == 4) {
            const deviceName = 'Human NIBP Nano';
            devStream.destroy(); // stop 'data' and 'error' callbacks
            const physicalDevice = new PhysicalDevice(
               this,
               deviceConnection,
               deviceName
            );
            callback(null, physicalDevice);
         } else {
            const versionCmdKey = Object.keys(NanoTxVersionCmds)[
               this.versionInfoArray.length
            ];
            devStream.write(NanoTxVersionCmds[versionCmdKey]);
            //TODO: set number of retries and then bail
         }
      });

      // connect error handler
      devStream.on('error', err => {
         console.error(err); // errors include timeouts
         devStream.destroy(); // stop 'data' and 'error' callbacks
         callback(err, null); // errors include timeouts
      });

      return;
   }

   /**
    * @param quarkProxy the Quark component of the ProxyDevice - used for notifying Quark of events
    * @param physicalDevice the instance of your implementation of PhysicalDevice
    * @returns a ProxyDevice
    */
   createProxyDevice(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: PhysicalDevice | null
   ) {
      return new ProxyDevice(quarkProxy, physicalDevice);
   }

   indexOfBestMatchingDevice(
      descriptor: OpenPhysicalDeviceDescriptor,
      availablePhysDevices: OpenPhysicalDeviceDescriptor[]
   ): number {
      return 0;
   }
}

class NIBPNanoUI implements IDeviceUIApi {
   name = 'NIBP nano device UI';
   type: PluginFeatureTypes = 'Device UI';

   // We provide UI for NIBP devices.
   matchesDevice(deviceClassGuid: string, deviceInternalName: string): boolean {
      return deviceClassGuid === deviceClassId;
   }

   // Store the result of the last HCU zero operation so it can be displayed to the
   // user.
   private static lastHcuStatus = '';

   /**
    * Called by Lightning when the user wishes to configure the device.
    *
    * @param deviceSettings Javascript object containing all settings for the
    * device.
    * @param deviceIndex Index of the device within the recording (i.e. will be
    * 0 for the first device or if it is the only device used in the recording).
    * @param deviceManager Provides access to the recording's device management
    * interface.
    */
   describeDeviceSettingsUI(
      deviceSettings: IDeviceSettingsApi,
      deviceId: DeviceProxyId,
      deviceManager: IDeviceManagerApi,
      deviceProxy?: IDeviceProxyAPI
   ): IUIAreaApi {
      const elements: IUIElementApi[] = [];

      const settings = deviceSettings as NIBPSettings;

      const { isSampling } = deviceManager;

      const testModeEnabled = !!settings.testMode.value;

      elements.push({
         type: 'device-name',
         title: 'Configure NIBP Device'
      });

      elements.push({
         type: 'header',
         title: 'Sampling setup'
      });

      const ZERO_SUPPORT = false;
      if (!ZERO_SUPPORT) {
         elements.push({
            type: 'message',
            text:
               'NOTE: height correction is not yet supported and has been disabled.'
         });
      }

      elements.push({
         type: 'action',
         label: 'Height correction',
         buttonText: 'Zero',
         actionInProgressText: 'Zeroing',
         disabled: !ZERO_SUPPORT,
         calcDisabled: () => isSampling || testModeEnabled,
         action: callback => {
            // Let the UI know we've started a time-consuming action.
            callback &&
               callback({
                  type: 'started',
                  options: 'default'
               });

            const pathToDevice = deviceManager.settingsPath({
               type: 'device',
               deviceId
            });

            // Make the process take a wee bit of time so the user feels the button click
            // actually did something.
            setTimeout(() => {
               deviceManager
                  .callFunction(pathToDevice, 'hcuZero', JSON.stringify({}))
                  .then(result => {
                     if (result) {
                        NIBPNanoUI.lastHcuStatus = result.hcuStatus;
                     }
                  })
                  .catch(error => {
                     console.error('HCU zero failed: ' + error);
                  })
                  .finally(() => {
                     // We've finished, tell Lightning to re-enable other UI elements.
                     callback &&
                        callback({
                           type: 'finished',
                           options: 'refresh all'
                        });
                  });
            }, 1000);
         }
      });

      if (NIBPNanoUI.lastHcuStatus) {
         elements.push({
            type: 'message',
            label: '',

            text: NIBPNanoUI.lastHcuStatus
         });
      }

      elements.push({
         type: 'setting',
         setting: settings.autoCalibrate,
         controlType: 'toggle',
         info:
            'Auto-calibration improves accuracy in the arterial blood pressure measurement by providing an ongoing calibration, approximately every 70 beats during longer recordings and more often in the first few minutes of recording.\n\nIt is recommended to enable this setting unless the subject is moving around considerably during recording.',
         disabled: testModeEnabled
      });

      elements.push({
         type: 'setting',
         setting: settings.cuffMode,
         controlType: 'list',
         disabled: testModeEnabled
      });

      const cuffSwitchingEnabled =
         settings.cuffMode.value === CuffMode.SwitchCuffs;

      if (cuffSwitchingEnabled) {
         elements.push({
            type: 'setting',
            setting: settings.cuffSwitchingInterval,
            controlType: 'list',
            disabled: testModeEnabled
         });
      }

      this.describeTestModeUI(settings, elements, isSampling);

      return {
         elements,
         layout: 'default',
         desiredWidthPixels: 420,
         desiredHeightPixels: 378
      };
   }

   private describeTestModeUI(
      settings: NIBPSettings,
      elements: IUIElementApi[],
      isSampling: boolean
   ) {
      const enabled = settings.testMode.value;

      elements.push({
         type: 'header',
         title: 'Test mode',
         subtitle:
            'Enable test mode to verify that the Human NIBP Nano is functioning correctly.',
         disabled: isSampling
      });

      const TEST_MODE_SUPPORT = false;
      if (!TEST_MODE_SUPPORT) {
         elements.push({
            type: 'message',
            text: 'NOTE: Test mode is not yet supported and has been disabled.'
         });
      }

      elements.push({
         type: 'setting',
         setting: settings.testMode,
         controlType: 'toggle',
         disabled: !TEST_MODE_SUPPORT || isSampling
      });

      elements.push({
         type: 'setting',
         setting: settings.testType,
         disabled: !enabled || isSampling,
         controlType: 'list',
         indentLevel: 1
      });

      switch (settings.testType.value as NanoTestTypes) {
         case NanoTestTypes.SteadyPressure:
            elements.push({
               type: 'setting',
               setting: settings.testSteadyPressure,
               disabled: !enabled || isSampling,
               controlType: 'list',
               indentLevel: 1
            });

            break;
         case NanoTestTypes.SquareWave:
            elements.push({
               type: 'setting',
               setting: settings.testSquarePressureOffset,
               disabled: !enabled || isSampling,
               controlType: 'list',
               indentLevel: 1
            });

            elements.push({
               type: 'message',
               label: 'Pressure amplitude',
               text: '+/- 50 mmHg from offset',
               disabled: !enabled || isSampling,
               indentLevel: 1
            });

            elements.push({
               type: 'setting',
               setting: settings.testSquareWaveFreq,
               disabled: !enabled || isSampling,
               controlType: 'list',
               indentLevel: 1
            });

            break;
         case NanoTestTypes.SimulatePressure:
            elements.push({
               type: 'message',
               text:
                  'The simulated pressure test does not inflate the finger cuffs. The controller generates a continuous square waveform in the Finger Pressure and HCU Pressure signals with a period of approximately 5 seconds.'
            });
            break;
      }
   }
}

module.exports = {
   getDeviceClasses() {
      return [new DeviceClass()];
   },
   getDeviceUIClasses() {
      return [new NIBPNanoUI()];
   }
};
