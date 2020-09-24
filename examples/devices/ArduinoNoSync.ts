/**
 * Example device driver for an Arduino device firmware (e.g. DueLightning.ino or SAMD51Lightning.ino)
 * that does not support round-trip or USB Frame time synchronization, with the result that Lightning
 * will fall back to "sampling counting" to try and adjust for the crystal oscillator drift between devices.
 *
 * This example does implement two optional methods (on the ProxyDevice object) that can improve the
 * accuracy of the initial inter-device timing at the start of sampling:
 *  getStartDelayMicroSeconds()
 *  getLocalClockTickAtSamplingStart()
 *
 * Notes:
 * - Quark is Lightning's C++ sampling engine.
 * - In order for this file to be registered by Lightning, it must be located
 *   under ~/Documents/LabChart Lightning/Plugins/devices
 * - Technical term: "Device class" is the set of types of device that can share the same settings.
 *
 * This file contains definitions for three necessary objects:
 * - ProxyDevice: an object that is created for each recording. Manages hardware settings and sampling.
 * - PhysicalDevice: an object that is a representation of the connected hardware device.
 * - DeviceClass: an object that represents the device class and can find and create PhysicalDevice
 *   objects of its class, as well as the ProxyDevice objects.
 */

/* eslint-disable no-fallthrough */

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
   TInt64,
   TimePoint,
   TimePointInfo,
   ADITimePointInfoFlags,
   FirstSampleRemoteTime
} from '../../public/device-api';

import { Setting } from '../../public/device-settings';

import { UnitsInfoImpl, UnitsInfo16Bit } from '../../public/device-units';

import { DuplexStream } from '../../public/device-streams';

import { StreamRingBufferImpl } from '../../public/stream-ring-buffer';

import { Parser } from '../../public/packet-parser';

//Don't fire notifications into Lightning too often!
const kMinimumSamplingUpdatePeriodms = 50;

// Imported libs set in getDeviceClass(libs) in module.exports below
// obtained from quark-enums
type Enum = { [key: string]: number };

const kSettingsVersion = 1;

const kDataFormat = ~~BlockDataFormat.k16BitBlockDataFormat; // For now!

//Support for compensating for a known fixed delay between asking the device
//to start sampling and the time when the first sample is actually measured
//by the ADC on the device.
const kTimeFromStartToFirstSampleMicroSeconds = 0;

//This needs to match the default rate in the hardware after it reboots!
const kDefaultSamplesPerSec = 100;

const kSampleRates = [
   //   20000.0,
   //   10000.0,
   4000.0,
   2000.0,
   1000.0,
   400.0,
   200.0,
   100.0
];

const kMinOutBufferLenSamples = 1024;

const kDefaultDecimalPlaces = 3;

// We implement a subset of the OpenBCI Cyton gains for demo purposes.
// From http://www.ti.com/lit/ds/symlink/ads1299.pdf
// 1 LSB = (2 × VREF / Gain) / 2^24 = +FS / 2^23
// VREF = 4.5 V
// Currently we are only keeping the high 16 bits of the 24 bits (k16BitBlockDataFormat)

const posFullScaleVAtGain1x = 3.3;

const kUnitsForGain1x = new UnitsInfoImpl(
   'V', //unit name
   UnitPrefix.kNoPrefix, //unit prefix
   kDefaultDecimalPlaces,
   posFullScaleVAtGain1x, //maxInPrefixedUnits
   0x7fff, //maxInADCValues (0x7fffff when we switch to 24 bit support)
   -posFullScaleVAtGain1x, //minInPrefixedUnits
   -0x7fff, //minInADCValues
   0x7fff, //maxValidADCValue
   -0x7fff //minValidADCValue
);

const kUnitsForGain2x = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kNoPrefix, //unit prefix
   kDefaultDecimalPlaces,
   posFullScaleVAtGain1x / 2, //maxInPrefixedUnits
   -posFullScaleVAtGain1x / 2 //minInPrefixedUnits
);

const kUnitsForGain12x = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kMilli, //unit prefix
   kDefaultDecimalPlaces,
   (1000 * posFullScaleVAtGain1x) / 12, //maxInPrefixedUnits
   (-1000 * posFullScaleVAtGain1x) / 12 //minInPrefixedUnits
);

const kUnitsForGain24x = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kMilli, //unit prefix
   kDefaultDecimalPlaces,
   (1e3 * posFullScaleVAtGain1x) / 24, //maxInPrefixedUnits
   (-1e3 * posFullScaleVAtGain1x) / 24 //minInPrefixedUnits
);

const kDefaultUnits = kUnitsForGain24x;

export function unitsFromPosFullScale(posFullScale: number) {
   switch (posFullScale) {
      case kUnitsForGain1x.maxInPrefixedUnits:
         return kUnitsForGain1x;
      case kUnitsForGain2x.maxInPrefixedUnits:
         return kUnitsForGain2x;
      case kUnitsForGain12x.maxInPrefixedUnits:
         return kUnitsForGain12x;
      case kUnitsForGain24x.maxInPrefixedUnits:
         return kUnitsForGain24x;
   }
   return kUnitsForGain1x;
}

export function gainCharFromPosFullScale(posFullScale: number) {
   switch (posFullScale) {
      case kUnitsForGain1x.maxInPrefixedUnits:
         return '0';
      case kUnitsForGain2x.maxInPrefixedUnits:
         return '1';
      case kUnitsForGain12x.maxInPrefixedUnits:
         return '5';
      case kUnitsForGain24x.maxInPrefixedUnits:
         return '6';
   }
   return '0';
}

const kStreamNames = ['ADC Input 1', 'ADC Input 2'];

const kEnableLogging = false;

export let gSampleCountForTesting = 0;

export function resetgSampleCountForTesting() {
   gSampleCountForTesting = 0;
}

/**
 * PhysicalDevice is a representation of the connected hardware device
 */
export class PhysicalDevice implements OpenPhysicalDevice {
   deviceName: string;
   serialNumber: string;
   deviceStream: DuplexStream;
   parser: ParserWithSettings;
   numberOfChannels: number;

   constructor(
      private deviceClass: DeviceClass,
      deviceStream: DuplexStream,
      friendlyName: string,
      versionInfo: string
   ) {
      this.numberOfChannels = kStreamNames.length;
      this.serialNumber = `ArduinoRT-123`; //TODO: get this from versionInfo (which should be JSON)

      this.parser = new ParserWithSettings(deviceStream, this.numberOfChannels);
      this.deviceName = deviceClass.getDeviceClassName() + ': ' + friendlyName;
   }

   release() {
      if (this.deviceStream) {
         this.deviceStream.destroyConnection();
      }
   }

   onError = (err: Error) => {
      console.warn(err);
   };

   /**
    * @returns the name of the device
    */
   getDeviceName() {
      return this.deviceName;
   }

   /**
    * @returns number of analog inputs on this device
    */
   getNumberOfAnalogInputs() {
      return this.numberOfChannels;
   }

   /**
    * @returns number of analog output streams on this device
    */
   getNumberOfAnalogStreams() {
      return this.numberOfChannels;
   }

   getDescriptor(): OpenPhysicalDeviceDescriptor {
      return {
         deviceType: this.deviceClass.getDeviceClassName(),
         numInputs: this.getNumberOfAnalogInputs(),
         deviceId: this.serialNumber || this.deviceStream.source.devicePath
      };
   }
}

class InputSettings {
   range: Setting;

   setValues(other: IDeviceInputSettingsSys) {
      this.range.setValue(other.range);
   }

   constructor(
      proxy: ProxyDevice,
      index: number,
      streamSettings: StreamSettings,
      settingsData: IDeviceInputSettingsSys
   ) {
      //Gain range setting
      this.range = new Setting(
         settingsData.range,
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            proxy.updateStreamSettings(index, streamSettings, {
               unitsInfo: unitsFromPosFullScale(setting.value as number)
            });

            return newValue;
         }
      );

      //Next input setting
   }
}

class StreamSettings implements IDeviceStreamApiImpl {
   enabled: Setting;
   samplesPerSec: Setting;
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
      this.streamName = kStreamNames[inputIndex];

      //enabled by default for now!
      this.enabled = new Setting(
         settingsData.enabled,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(streamIndex, this, {}); //N.B. newValue has already been set on value prop
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
   }
}

class DeviceStreamConfiguration implements IDeviceStreamConfiguration {
   unitsInfo: UnitsInfo;

   constructor(
      posFullScaleV: number = posFullScaleVAtGain1x,
      public dataFormat = kDataFormat
   ) {
      this.unitsInfo = unitsFromPosFullScale(posFullScaleV);
   }
}

enum ParserState {
   kUnknown,
   kIdle,
   kStartingSampling,
   kLookingForPacket,
   kSampling,
   kError
}

const kPacketStartByte = 0x50; //'P'

/**
 * An object that handles parsing of data returned from the example device.
 * Note that this is device-specific and will need to be changed for any other device.
 */

class ParserWithSettings extends Parser {
   samplesPerSec: number;

   constructor(public inStream: IDuplexStream, nADCChannels: number) {
      super(inStream, nADCChannels);
      this.samplesPerSec = kDefaultSamplesPerSec;
   }

   setSamplesPerSec(samplesPerSec: number): number {
      //All input samples are at the same rate
      if (this.samplesPerSec === samplesPerSec) {
         return samplesPerSec;
      }
      const index = kSampleRates.indexOf(samplesPerSec);
      if (index >= 0) {
         const char = '0123456789'.charAt(index);
         this.inStream.write('~' + char + '\n');
         this.samplesPerSec = samplesPerSec;
      }
      return samplesPerSec;
   }

   setGain(input: number, posFullScale: number) {
      if (0 <= input && input < 8) {
         const gainChar = gainCharFromPosFullScale(posFullScale);
         const inputChar = String.fromCharCode(48 + input);
         //See https://docs.openbci.com/docs/02Cyton/CytonSDK#channel-setting-commands
         const commandStr =
            'x' + inputChar + '0' + gainChar + '0' + '1' + '1' + '0' + 'X\n';
         //this.inStream.write(commandStr);
      }
   }
}

const kDefaultEnabled: IDeviceSetting = {
   settingName: 'Enabled',
   value: true,
   options: [
      { value: true, display: new Boolean(true).toString() },
      { value: false, display: new Boolean(false).toString() }
   ]
};

const kDefaultDisabled: IDeviceSetting = {
   settingName: 'Disabled',
   value: false,
   options: [
      { value: true, display: new Boolean(true).toString() },
      { value: false, display: new Boolean(false).toString() }
   ]
};

const kDefaultInputSettings: IDeviceInputSettingsSys = {
   range: {
      settingName: 'Range',
      value: kDefaultUnits.maxInPrefixedUnits,
      options: [
         {
            value: kUnitsForGain1x.maxInPrefixedUnits,
            display: kUnitsForGain1x.rangeDisplayString
         },
         {
            value: kUnitsForGain2x.maxInPrefixedUnits,
            display: kUnitsForGain2x.rangeDisplayString
         },
         {
            value: kUnitsForGain12x.maxInPrefixedUnits,
            display: kUnitsForGain12x.rangeDisplayString
         },
         {
            value: kUnitsForGain24x.maxInPrefixedUnits,
            display: kUnitsForGain24x.rangeDisplayString
         }
      ]
   }
};

const kDefaultRate: IDeviceSetting = {
   settingName: 'Rate',
   value: kDefaultSamplesPerSec,
   options: [
      {
         value: kSampleRates[5],
         display: kSampleRates[5].toString() + ' Hz'
      },
      {
         value: kSampleRates[4],
         display: kSampleRates[4].toString() + ' Hz'
      },
      {
         value: kSampleRates[3],
         display: kSampleRates[3].toString() + ' Hz'
      },
      {
         value: kSampleRates[2],
         display: kSampleRates[2].toString() + ' Hz'
      },
      {
         value: kSampleRates[1],
         display: kSampleRates[1].toString() + ' Hz'
      },
      {
         value: kSampleRates[0],
         display: kSampleRates[0].toString() + ' Hz'
      }
   ]
};

function getDefaultSettings() {
   const kDefaultSettings = {
      version: kSettingsVersion,
      dataInStreams: kStreamNames.map(() => ({
         enabled: kDefaultEnabled,
         inputSettings: kDefaultInputSettings,
         samplesPerSec: kDefaultRate
      }))
   };

   return kDefaultSettings;
}

function getDefaultDisabledStreamSettings() {
   const result = {
      enabled: kDefaultDisabled,
      inputSettings: kDefaultInputSettings,
      samplesPerSec: kDefaultRate
   };
   return result;
}

/**
 * The ProxyDevice object is created for each recording. Manages hardware settings and sampling.
 */
class ProxyDevice implements IProxyDevice {
   /**
    * Any state within "settings" will be saved / loaded by the application.
    */
   settings: IDeviceProxySettingsSys;

   lastError: Error | null;

   /**
    * outStreamBuffers
    *
    * After sampled data has been parsed, it needs to be written to these buffers.
    * There is a buffer for each device stream
    */
   outStreamBuffers: StreamRingBuffer[];

   physicalDevice: PhysicalDevice | null;
   proxyDeviceSys: ProxyDeviceSys | null;

   //Only non-null if this proxy is the one with a lock on the PhysicalDevice
   parser: ParserWithSettings | null;

   /**
    * @returns if the device is sampling
    */
   get isSampling(): boolean {
      // Need to reset this even if sampling stops because the device went bad
      return this.parser ? this.parser.isSampling() : false;
   }

   // Pass null for PhysicalDevice when proxy created in absence of hardware
   constructor(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: PhysicalDevice | null,
      settings: IDeviceProxySettingsSys
   ) {
      this.outStreamBuffers = [];
      this.proxyDeviceSys = quarkProxy;
      this.physicalDevice = physicalDevice;
      this.parser = null;
      this.lastError = null;

      /**
       * Initialize the settings for the device to defaults or cloned settings passed in.
       * This does two things:
       * 1) Ensures any associated settings for the device (rates, gains) have
       *    helpful defaults.
       * 2) Sets up settings interactivity so that if a setting is changed by the
       *    user, the hardware can respond accordingly.
       *
       * @param nStreams The number of streams of data available from the hardware.
       */
      this.initializeSettings(settings);
   }

   clone(quarkProxy: ProxyDeviceSys | null): ProxyDevice {
      if (kEnableLogging) console.log('ProxyDevice.clone()');
      return new ProxyDevice(quarkProxy, this.physicalDevice, this.settings);
   }

   release(): void {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.release();
      }
   }

   /**
    * Called for both new and existing recordings. Initialize all settings for this device that are
    * to be saved in the recording.
    *
    * @param nStreams The number of default streams to initialize for.
    */
   initializeSettings(settingsData: IDeviceProxySettingsSys) {
      const defaultSettings = getDefaultSettings();
      this.settings = getDefaultSettings();
      this.settings.dataInStreams = [];

      const nDeviceStreams = this.physicalDevice
         ? this.physicalDevice.getNumberOfAnalogStreams()
         : 0;

      const nSettingsStreams = settingsData.dataInStreams.length;
      const nStreams = Math.max(nSettingsStreams, nDeviceStreams);

      const defaultDisabledStreamSettings = getDefaultDisabledStreamSettings();

      // Ensure the settings have the correct number of data in streams for the current physical
      // device. This logic is complicated by the fact we fake up physical devices having different
      // stream counts for testing purposes.
      for (let streamIndex = 0; streamIndex < nStreams; ++streamIndex) {
         const defaultStreamSettingsData =
            defaultSettings.dataInStreams[streamIndex] ||
            defaultDisabledStreamSettings;

         let streamSettingsData = settingsData.dataInStreams[streamIndex];

         // Disable the stream if it is beyond the end of the number stored
         // in the existing settings or is beyond the number supported by the current physical
         // device.
         if (!streamSettingsData) {
            //There are no existing settings for this stream for this hardware
            streamSettingsData = defaultDisabledStreamSettings;
         } else if (streamIndex >= defaultSettings.dataInStreams.length) {
            //There is an existing setting for a stream not supported by the current hardware.
            //Keep the settings but disable the stream.
            streamSettingsData.enabled.value = false;
         }

         //If multiple streams share the hardware input they should reference the same InputSettings object
         const inputIndex = streamIndex; //Default to 1 to 1
         const streamSettings = new StreamSettings(
            this,
            streamIndex,
            inputIndex,
            defaultStreamSettingsData //use default settings to get correct options
         );

         streamSettings.inputSettings = new InputSettings(
            this,
            inputIndex,
            streamSettings,
            defaultStreamSettingsData.inputSettings
         );

         //Assign values not (old) options!
         streamSettings.setValues(streamSettingsData);

         this.settings.dataInStreams.push(streamSettings);
         this.updateStreamSettings(
            streamIndex,
            streamSettings,
            new DeviceStreamConfiguration(
               streamSettings.inputSettings.range.value as number
            ),
            false // No need to restart any sampling for, say, undo / redo
         );
      }
   }

   applyAllSettingsToHardwareOnly() {
      //TODO: apply any other custom hardware settings

      //Example of how one might apply the stream settings to the hardware
      const nDeviceStreams = this.physicalDevice
         ? this.physicalDevice.getNumberOfAnalogStreams()
         : 0;

      for (let streamIndex = 0; streamIndex < nDeviceStreams; ++streamIndex) {
         const stream = this.settings.dataInStreams[streamIndex];
         this.applyStreamSettingsToHW(streamIndex, stream as StreamSettings)(
            null,
            SysStreamEventType.kApplyStreamSettingsToHardware
         );
      }
   }

   updateStreamSettings(
      streamIndex: number,
      streamSettings: StreamSettings,
      config: Partial<IDeviceStreamConfiguration>,
      restartAnySampling = true
   ) {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.setupDataInStream(
            streamIndex,
            streamSettings,
            config,
            this.applyStreamSettingsToHW(streamIndex, streamSettings),
            restartAnySampling
         );
      }
   }

   //TODO: pass the actual setting that changed
   //Note this is a curried function so it can be called by Quark on the main JS thread after sampling has stopped, if needed.
   applyStreamSettingsToHW = (
      streamIndex: number,
      streamSettings: StreamSettings
   ) => (error: Error | null, type: SysStreamEventType): void => {
      if (error) console.error(error);
      else if (type === SysStreamEventType.kApplyStreamSettingsToHardware) {
         if (this.parser) {
            this.parser.setSamplesPerSec(
               Number(streamSettings.samplesPerSec.value)
            );
            this.parser.setGain(
               streamIndex,
               Number(streamSettings.inputSettings.range.value)
            );
         }
         //TODO: replace this console log with actually sending appropriate command(s) to the hardware
         if (kEnableLogging)
            console.log(
               'Apply stream settings to hardware for stream',
               streamIndex
            );
      }
   };

   onError = (err: Error) => {
      this.lastError = err;
      console.warn(err);
   };

   getOutBufferInputIndices(): Int32Array {
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
    * @returns if the operation succeeded
    */
   setPhysicalDevice(physicalDevice: OpenPhysicalDevice): boolean {
      this.physicalDevice = physicalDevice as PhysicalDevice;

      if (kEnableLogging) console.log('setPhysicalDevice()');
      // If the hardware capabilities have changed, this is where the process
      // to translate from existing settings is performed.
      // Where hardware capabilities are reduced, the existing settings should
      // be left alone (in case original hardware comes back in future).
      // e.g. set hwSupport = false on the relevant setting.

      // Create the settings structure, copying our saved settings info into it.
      this.initializeSettings(this.settings);

      return true;
   }

   /**
    * Called from Quark when re-opening an existing recording to restore the
    * settings.
    *
    * @param settings is the settings saved in the recording for this device.
    * @returns whether the operation succeeded.
    */
   setSettings(settings: IDeviceProxySettingsSys) {
      if (kEnableLogging) console.log('ProxyDevice.setSettings()');
      // Create the settings structure, copying our saved settings info into it.
      this.initializeSettings(settings);

      return true;
   }

   /**
    * Called from Quark to get the last error detected by the proxy
    *
    * @returns the last error as a string
    */
   getLastError(): string {
      return this.lastError ? this.lastError.message : '';
   }

   /**
    * Called from Quark. Only returns device name if proxy has
    * access to PhysicalDevice
    *
    * @returns device name
    */
   getDeviceName(): string {
      if (this.physicalDevice) return this.physicalDevice.getDeviceName();
      return 'no device';
   }

   /**
    * Devices have hardware inputs and software outputs which we call streams.
    * There is not always a one to one mapping between these. Lightning maps streams
    * onto channels in a recording.
    *
    * @returns the number of analog output streams for this device
    */
   getNumberOfAnalogStreams(): number {
      return this.settings.dataInStreams.length;
   }

   /**
    * Called from Quark to allow this proxy to communicate with the device.
    * It is never called if another proxy is currently connected to the device.
    * It is called when the UI is trying to use the device, e.g. by changing a
    * setting or starting sampling.
    * This function should send the entire settings state is applied to the hardware
    * because it is likely another proxy with different settings has been using the
    * hardware.
    *
    * @returns if operation succeeded
    */
   connectToPhysicalDevice(): boolean {
      if (kEnableLogging) console.log('connectToPhysicalDevice()');

      if (this.parser) {
         console.warn('connectToPhysicalDevice: already connected!');
         return true;
      }

      if (this.physicalDevice) {
         this.parser = this.physicalDevice.parser;
         this.parser.setProxyDevice(this);

         if (kEnableLogging)
            console.log('Sending complete settings to hardware device');
         //Actually send the settings to the hardware
         this.applyAllSettingsToHardwareOnly();
         return true;
      }
      this.lastError = new Error('physical device missing');
      return false;
   }

   /**
    * Called from Quark to prevent multiple proxies trying to communicate with the device at the same time.
    */
   disconnectFromPhysicalDevice(): void {
      if (this.parser) {
         this.parser.setProxyDevice(null);
         this.parser = null; // Drop our reference to the parser in the PhysicalDevice
      }
      if (kEnableLogging) console.log('disconnectFromPhysicalDevice()');
   }

   /**
    * Called from Quark when user sets recording rate in single-rate mode.
    * If possible, set all this proxy's streams to closest possible rate <= samplesPerSec.
    */
   setAllChannelsSamplesPerSec(samplesPerSec: number): boolean {
      for (const stream of this.settings.dataInStreams) {
         stream.samplesPerSec.value = samplesPerSec;
      }

      return true;
   }

   /**
    * @param bufferSizeInSecs should be used to calculate the size in samples of the ring buffers allocated
    * for each output stream. Quark guarantees to remove samples from these buffers well before they
    * become full if they are of this length.
    *
    * @returns if the operation succeeded. If this returns false, the calling code could call getLastError()
    * to find out what's wrong.
    */
   prepareForSampling(bufferSizeInSecs: number): boolean {
      if (!this.parser || !this.physicalDevice) return false; // Can't sample if no hardware connection

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

      return true;
   }

   /**
    * Called from Quark. Device command to start sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStarted) needs to be called on the ProxyDeviceSys
    *
    * @returns if device successfully started to sample
    */
   startSampling(): boolean {
      if (!this.parser) return false; // Can't sample if no hardware connection

      return this.parser.startSampling();
   }

   /**
    * Called from Quark. Device command to stop sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStopped) needs to be called on the ProxyDeviceSys
    *
    * @returns if device successfully stopped sampling
    */
   stopSampling(): boolean {
      if (!this.parser) return false; // Can't sample if no hardware connection
      return this.parser.stopSampling();
   }

   /**
    * Called from Quark after sampling has finished. The outStreamBuffers should be reset here.
    *
    * @returns if cleanup succeeded
    */
   //If this returns false, the calling code could call getLastError() to find out what's wrong
   cleanupAfterSampling(): boolean {
      this.outStreamBuffers = [];
      return true;
   }

   onSamplingStarted() {
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(DeviceEvent.kDeviceStarted);
   }

   onSamplingStopped(errorMsg: string) {
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStopped,
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

   //Optional support for compensating for a known fixed delay between asking the device
   //to start sampling and the time when the first sample is actually measured
   //by the ADC on the device.
   getStartDelayMicroSeconds(): number {
      return kTimeFromStartToFirstSampleMicroSeconds;
   }

   //Optional support for providing a more accurate estimate of the time (using the local PC's steady clock)
   //at which the device actually started sampling
   getLocalClockTickAtSamplingStart(): TInt64 | undefined {
      if (this.parser) {
         return this.parser.localClockAtSamplingStart;
      }
      return undefined;
   }
} //ProxyDevice

/**
 * The device class is the set of types of device that can share the same settings so that
 * when a recording is re-opened, Quark will try to match device proxies read from disk to
 * available physical devices on a "best fit" match of capabilies.
 * The DeviceClass object represents this set of devices and can find and create PhysicalDevice
 * objects of its class, as well as the ProxyDevice objects.
 */
export class DeviceClass implements IDeviceClass {
   /**
    * Called when the app shuts down. Chance to release any resources acquired during this object's
    * life.
    */
   release(): void {}

   /**
    * Required member for devices that support being run against Lightning's
    * test suite.
    */
   clearPhysicalDevices(): void {}

   onError(err: Error): void {
      console.error(err);
   }

   /**
    * @returns the name of the class of devices
    */
   getDeviceClassName(): string {
      return 'ArduinoNoSync';
   }

   /**
    * @returns a GUID to identify this object
    */
   getClassId() {
      // UUID generated using https://www.uuidgenerator.net/version1
      return '917adfc8-d6bf-11ea-87d0-0242ac130003';
   }

   /**
    * @returns a TDeviceConnectionType that defines the connection type.
    * ie. USB, serial etc.
    */
   getDeviceConnectionType(): TDeviceConnectionType {
      return TDeviceConnectionType.kDevConTypeSerialPort;
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
      callback: (error: Error | null, device: OpenPhysicalDevice | null) => void
   ): void {
      const vid = deviceConnection.vendorId.toUpperCase();
      const pid = deviceConnection.productId.toUpperCase();

      /** Uncomment following 2 lines to disable this device class so that e.g. the ArduinoRoundTrip script finds the device instead */
      //callback(null, null); // Did not find one of our devices on this connection
      //return;

      if (
         !(vid === '2341' && pid === '003E') && //Due Native port 003E
         //!(vid === '2341' && pid === '003D') && //Due Programming port 003D (not recommended)!

         /** N.B. The following SAMD devices do not have stable timing unless the Arduino firmware (sketch)
          *  is built using the ADInstruments Arduino core!
          */
         !(vid === '239A' && pid === '801B') && //ADAFruit Feather M0 Express
         !(vid === '239A' && pid === '8022') && //ADAFruit Feather M4
         !(vid === '1B4F' && pid === 'F016') //Sparkfun Thing Plus SAMD51

         // && !(deviceConnection.manufacturer === 'Arduino LLC (www.arduino.cc)')
      ) {
         callback(null, null); // Did not find one of our devices on this connection
         return;
      }

      const kArduinoRebootTimems = 2000;
      const kTimeoutms = 2000; // Time for device to  respond
      const devStream = new DuplexStream(deviceConnection);

      const friendlyName = deviceConnection.friendlyName;

      //node streams default to 'utf8' encoding, which most devices won't understand.
      //With 'utf8' encoding, non-ascii chars, such as:
      //devStream.write('\xD4\x02\x02\xD4\x76\x0A\x62');
      //could be expanded into multiple bytes, so we use 'binary' instead.
      devStream.setDefaultEncoding('binary');

      // connect error handler
      devStream.on('error', (err: Error) => {
         console.warn(err); // errors include timeouts
         devStream.destroy(); // stop 'data' and 'error' callbacks
         callback(err, null);
      });

      const deviceClass = this;
      let resultStr = '';

      // Give up if device is not detected within the timeout period
      const deviceVersionTimeout = global.setTimeout(() => {
         devStream.destroyConnection(); // stop 'data' and 'error' callbacks
         const err = new Error(
            `Timed out: device ${friendlyName} did not respond to version request.`
         );
         console.warn(err);
         callback(err, null);
      }, kArduinoRebootTimems + kTimeoutms);

      // connect data handler
      devStream.on('data', (newBytes: Buffer) => {
         const newStr = newBytes.toString();
         resultStr += newStr;
         // See if we got '$$$'
         const endPos = resultStr.indexOf('$$$');

         if (endPos !== -1) {
            const startPos = resultStr.indexOf('ArduinoRT');
            if (startPos >= 0) {
               // We found an ArduinoRT device
               clearTimeout(deviceVersionTimeout);

               const versionInfo = resultStr.slice(startPos, endPos);
               const physicalDevice = new PhysicalDevice(
                  deviceClass,
                  devStream,
                  friendlyName,
                  versionInfo
               );
               callback(null, physicalDevice);
            }
         }
      });

      deviceConnection.setOption({ baud_rate: 115200 });

      devStream.write('s\n'); //Stop it incase it is already sampling

      //Opening the serial port may cause the Arduino to reboot.
      //Wait for it to be running again before sending the v command.
      global.setTimeout(() => {
         // Tell the device to emit its version string.
         //devStream.setReadTimeout(kTimeoutms);
         devStream.write('v\n');
      }, kArduinoRebootTimems);

      return;
   }

   /**
    * @param quarkProxy the Quark component of the ProxyDevice - used for notifying Quark of events
    * @param physicalDevice the instance of your implementation of PhysicalDevice
    * @returns a ProxyDevice
    */
   createProxyDevice(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: OpenPhysicalDevice | null
   ): ProxyDevice {
      const physicalTestDevice = physicalDevice as PhysicalDevice | null;
      return new ProxyDevice(
         quarkProxy,
         physicalTestDevice,
         getDefaultSettings()
      );
   }

   indexOfBestMatchingDevice(
      descriptor: OpenPhysicalDeviceDescriptor,
      availablePhysDevices: OpenPhysicalDeviceDescriptor[]
   ): number {
      return 0;
   }
}

export function getDeviceClasses() {
   return [new DeviceClass()];
}
