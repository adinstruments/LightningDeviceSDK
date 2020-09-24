//'use strict';
/**
 * Example device driver for the OpenBCI Cyton device.
 *
 * Notes:
 * - Quark is Lightning's C++ sampling engine.
 * - In order for this file to be registered by Lightning, it must be located
 *   under [LIGHTNING_INSTALL_DIR]/resources/app/plugins
 * - Technical term: "Device class" is the set of types of device that can share the same settings.
 *
 * This file contains definitions for three necessary objects:
 * - PhysicalDevice: an object that is a representation of the connected hardware device.
 *   Multiple recordings can use the same PhysicalDevice, but only one can sample with that device at any time.
 * - ProxyDevice: an object that is created for each recording to represent the PhysicalDevice.
 *   Manages the device settings and access to sampling for that recording.
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
   OpenPhysicalDeviceDescriptor
} from '../../../public/device-api';

import { Setting } from '../../../public/device-settings';

import { UnitsInfoImpl, UnitsInfo16Bit } from '../../../public/device-units';

import { DuplexStream } from '../../../public/device-streams';

import { StreamRingBufferImpl } from '../../../public/stream-ring-buffer';

const deviceClassId = '06051a8c-37c3-11e8-b467-0ed5f89f718b';
// UUID generated using https://www.uuidgenerator.net/version1

const kSettingsVersion = 1;

function getDataFormat() {
   return ~~BlockDataFormat.k16BitBlockDataFormat;
}

const kDefaultSamplesPerSec = 250;
const kChannelsPerADS1299 = 8;

const kMinOutBufferLenSamples = 1024;

const kDefaultDecimalPlaces = 3;

// From http://www.ti.com/lit/ds/symlink/ads1299.pdf
// 1 LSB = (2 × VREF / Gain) / 2^24 = +FS / 2^23
// VREF = 4.5 V
// Currently we are only keeping the high 16 bits of the 24 bits (k16BitBlockDataFormat)

const posFullScaleVAtGain1x = 4.5;

function getDefaultUnits() {
   return new UnitsInfo16Bit(
      'V', // unit name
      UnitPrefix.kMilli, // unit prefix
      kDefaultDecimalPlaces,
      (1e3 * posFullScaleVAtGain1x) / 24, // maxInPrefixedUnits
      (-1e3 * posFullScaleVAtGain1x) / 24 // minInPrefixedUnits
   );
}

let gSampleCountForTesting = 0;

/**
 * PhysicalDevice is a representation of the connected hardware device
 */
class PhysicalDevice implements OpenPhysicalDevice {
   deviceName: string;
   typeName: string;
   deviceConnection: DuplexDeviceConnection;
   parser: CytonParser;
   numberOfChannels: number;

   constructor(
      deviceClass: IDeviceClass,
      deviceConnection: DuplexDeviceConnection,
      versionInfo: string
   ) {
      this.deviceConnection = deviceConnection;
      this.typeName = 'Unknown';
      this.numberOfChannels = 0;

      this.onError = this.onError.bind(this);
      this.processVersionInfo(versionInfo);
      const inStream = new DuplexStream(this.deviceConnection);
      this.parser = new CytonParser(inStream);
      this.deviceName = deviceClass.getDeviceClassName() + ' ' + this.typeName;
   }

   release() {
      if (this.deviceConnection) {
         this.deviceConnection.onStreamDestroy();
         this.deviceConnection.release();
      }
   }

   onError(err: Error) {
      console.warn(err);
   }

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

   processVersionInfo(versionInfo: string) {
      let adcs = 0;

      const searchStr = 'ADS1299';
      for (let adcPos = 0; true; ) {
         adcPos = versionInfo.indexOf(searchStr, adcPos);
         if (adcPos < 0) break;
         ++adcs;
         adcPos += searchStr.length;
      }

      this.numberOfChannels = kChannelsPerADS1299 * adcs;
      if (adcs >= 1) this.typeName = 'Cyton';
      if (adcs === 2) {
         this.typeName += ' with daisy';
      }
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
   //TODO: remove unitsInfo (see test-device.ts)
   unitsInfo: any; // UnitsInfo16Bit;
   range: any;

   setValues(other: IDeviceInputSettingsSys) {
      this.range.setValue(other.range);
   }

   constructor(
      proxy: ProxyDevice,
      index: number,
      streamSettings: StreamSettings,
      inputSettingsData: IDeviceInputSettingsSys
   ) {
      this.unitsInfo = getDefaultUnits();

      // Gain range setting
      this.range = new Setting(
         inputSettingsData.range,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(
               index,
               streamSettings,
               new DeviceStreamConfigurationImpl()
            );
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
      this.enabled = new Setting(
         settingsData.enabled,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(streamIndex, this, {}); // N.B. newValue has already been set on value prop
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

enum CytonState {
   kUnknown,
   kIdle,
   kStartingSampling,
   kLookingForPacket,
   kSampling,
   kError
}

/**
 * An object that handles parsing of data returned from the example device.
 * Note that this is device-specific and will need to be changed for any other device.
 */
class CytonParser {
   static kPacketSizeBytes = 33;

   state: CytonState = CytonState.kUnknown;
   lastError = '';
   bytesInPacket: number;
   packet: Buffer;
   expectedSampleCount: number; // is one byte (0 - 255)

   proxyDevice: IProxyDevice | null = null;

   incrementExpectedSampleCount() {
      this.expectedSampleCount++;
      this.expectedSampleCount &= 255;
      ++gSampleCountForTesting;
   }

   constructor(public inStream: any) {
      this.state = CytonState.kUnknown;
      this.lastError = '';
      this.proxyDevice = null;
      this.inStream = inStream;

      this.onError = this.onError.bind(this);
      this.onData = this.onData.bind(this);

      this.bytesInPacket = 0;
      this.packet = Buffer.alloc(CytonParser.kPacketSizeBytes);
      this.expectedSampleCount = 0;

      // node streams default to 'utf8' encoding, which most devices won't understand.
      // With 'utf8' encoding, non-ascii chars, such as:
      // devStream.write('\xD4\x02\x02\xD4\x76\x0A\x62');
      // could be expanded into multiple bytes, so we use 'binary' instead.
      this.inStream.setDefaultEncoding('binary');

      this.inStream.on('error', this.onError);

      // switches stream into flowing mode
      this.inStream.on('data', this.onData);
   }

   isSampling() {
      return CytonState.kIdle < this.state && this.state < CytonState.kError;
   }

   onError(err: Error) {
      this.lastError = err.message;
      console.warn(err);
   }

   setProxyDevice(proxyDevice: IProxyDevice) {
      this.proxyDevice = proxyDevice;
   }

   startSampling(): boolean {
      if (!this.inStream || !this.proxyDevice) return false;

      this.inStream.write('b'); // OpenBCI begin sampling command
      this.state = CytonState.kStartingSampling;
      this.expectedSampleCount = 0;
      this.bytesInPacket = 0; // Ignore any bytes stored from the previous sampling session.
      return true;
   }

   stopSampling() {
      this.state = CytonState.kIdle;
      if (!this.inStream) return false; // Can't sample if no hardware connection

      this.inStream.write('s'); // OpenBCI begin sampling command
      if (this.proxyDevice) this.proxyDevice.onSamplingStopped(''); // Normal user stop
      return true;
   }

   processPacket(data: Buffer) {
      const kStartOfDataIndex = 2;
      let lostSamples = 0;

      if (data[0] != 0xa0 || (data[32] & 0xf0) != 0xc0) {
         this.lastError = 'Cyton packet out of sync';
         console.warn(this.lastError);
         return false; // not in synch
      } else if (data[1] !== this.expectedSampleCount) {
         lostSamples = (data[1] - this.expectedSampleCount) & 255;
         console.warn('Cyton lost samples:', lostSamples);
      }

      if (!this.proxyDevice) {
         this.lastError =
            'Cyton parser processPacket() called with no proxyDevice';
         console.warn(this.lastError);
         return true;
      }

      const outStreamBuffers = this.proxyDevice.outStreamBuffers;
      const nStreams = outStreamBuffers.length;

      if (lostSamples) {
         for (let i = 0; i < lostSamples; ++i) {
            for (let streamIndex = 0; streamIndex < nStreams; ++streamIndex)
               outStreamBuffers[streamIndex].writeInt(0x8000); // insert 'out of range' values
         }
         this.expectedSampleCount = data[1]; // resynch
      }

      let byteIndex = kStartOfDataIndex;
      for (
         let streamIndex = 0;
         streamIndex < nStreams;
         ++streamIndex, byteIndex += 3
      ) {
         // The OpenBCI Cyton format is big endian 24 bit.
         // See http://docs.openbci.com/Hardware/03-Cyton_Data_Format
         const value =
            (data[byteIndex] << 16) +
            (data[byteIndex + 1] << 8) +
            data[byteIndex + 2];

         const int16Val = value >> 8; // just taking the high 16 bits
         outStreamBuffers[streamIndex].writeInt(int16Val);
      }
      this.incrementExpectedSampleCount();
      return true;
   }

   onData = (newBytes: Buffer) => {
      const nBytes = newBytes.length;
      if (!nBytes) return;

      let inOffset = 0;

      switch (this.state) {
         case CytonState.kIdle:
            return;

         case CytonState.kStartingSampling:
            this.state = CytonState.kLookingForPacket;
            this.expectedSampleCount = 0;
            if (this.proxyDevice) this.proxyDevice.onSamplingStarted();

         case CytonState.kLookingForPacket:
         case CytonState.kSampling:
            while (this.bytesInPacket && inOffset < nBytes) {
               // Handle partial packet left over from last onData()
               // Copy some new bytes into stored packet to try to get a complete packet
               const nToCopy = Math.min(
                  CytonParser.kPacketSizeBytes - this.bytesInPacket,
                  nBytes - inOffset
               );
               newBytes.copy(
                  this.packet,
                  this.bytesInPacket,
                  inOffset,
                  inOffset + nToCopy
               );
               this.bytesInPacket += nToCopy;
               inOffset += nToCopy;
               if (this.bytesInPacket >= CytonParser.kPacketSizeBytes) {
                  // we have a full packet
                  if (
                     this.packet[0] === 0xa0 &&
                     this.processPacket(this.packet)
                  ) {
                     this.bytesInPacket = 0; // successfully processed all the bytes stored in this.packet
                     this.state = CytonState.kSampling;
                  } else {
                     // search for packet start char, in the stored packet
                     this.state = CytonState.kLookingForPacket;
                     let startPos = this.packet[0] === 0xa0 ? 1 : 0; //Skip first byte if already checked
                     for (; startPos < this.bytesInPacket; ++startPos) {
                        if (this.packet[startPos] === 0xa0) {
                           break; // found a potential packet start byte
                        }
                     }
                     if (startPos < this.bytesInPacket) {
                        //retain some of the stored bytes, shifting them to start of packet
                        this.packet.copy(
                           this.packet,
                           0,
                           startPos,
                           this.bytesInPacket
                        );
                        this.bytesInPacket -= startPos;
                        this.state = CytonState.kSampling;
                     } else {
                        this.bytesInPacket = 0; // scrap the saved bytes
                     }
                  }
               }
            } // while (this.bytesInPacket)

            // handle newBytes
            while (nBytes - inOffset >= CytonParser.kPacketSizeBytes) {
               if (this.state === CytonState.kLookingForPacket) {
                  // search for packet start char in the newBytes
                  for (; inOffset < nBytes; ++inOffset) {
                     if (newBytes[inOffset] === 0xa0) {
                        this.state = CytonState.kSampling;
                        break; // found possible start of packet
                     }
                  }
               }

               if (this.state === CytonState.kLookingForPacket) break; // done
               if (nBytes - inOffset < CytonParser.kPacketSizeBytes) break; //done - not enough remaining newBytes

               if (
                  !this.processPacket(
                     newBytes.slice(
                        inOffset,
                        (inOffset += CytonParser.kPacketSizeBytes)
                     )
                  )
               ) {
                  inOffset -= CytonParser.kPacketSizeBytes - 1; // start searching from the 2nd byte in last packet
                  this.state = CytonState.kLookingForPacket;
               }
            } // while(nBytes - inOffset >= kPacketSizeBytes)

            break;
         case CytonState.kError:
            console.warn('Cyton parser: error state');
         default:
            console.warn('Cyton parser: unexpected state:', this.state);
      } // switch

      if (inOffset < nBytes) {
         // store partial packet
         if (nBytes - inOffset > CytonParser.kPacketSizeBytes)
            console.warn('Trying to store too many left over bytes in packet');
         if (this.bytesInPacket)
            console.warn('Writing over left over bytes in packet');
         this.bytesInPacket = newBytes.copy(
            this.packet,
            this.bytesInPacket,
            inOffset,
            nBytes
         );
      }

      if (this.proxyDevice) this.proxyDevice.onSamplingUpdate();
   }; // onData
} // CytonParser

class DeviceStreamConfigurationImpl implements IDeviceStreamConfiguration {
   unitsInfo: any;
   dataFormat: any;

   constructor() {
      this.unitsInfo = getDefaultUnits();
      this.dataFormat = getDataFormat();
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

const kDefaultInputSettings: IDeviceInputSettingsSys = {
   range: {
      settingName: 'Range',
      value: posFullScaleVAtGain1x,
      options: [
         {
            value: posFullScaleVAtGain1x,
            display: posFullScaleVAtGain1x.toString() + ' V'
         }
      ]
   }
};

const kDefaultRate: IDeviceSetting = {
   settingName: 'Rate',
   value: kDefaultSamplesPerSec,
   options: [
      {
         value: kDefaultSamplesPerSec,
         display: kDefaultSamplesPerSec.toString() + ' Hz'
      }
   ]
};

/**
 * Initialize the settings for the device to defaults. This does two things:
 * 1) Ensures any associated settings for the device (rates, gains) have
 *    helpful defaults.
 * 2) Sets up settings interactivity so that if a setting is changed by the
 *    user, the hardware can respond accordingly.
 *
 * @param nStreams The number of streams of data available from the hardware.
 */
function getDefaultSettings() {
   const kDefaultSettings = {
      version: kSettingsVersion,
      dataInStreams: [
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         },
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         },
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         },
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         },
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         },
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         },
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         },
         {
            enabled: kDefaultEnabled,
            inputSettings: kDefaultInputSettings,
            samplesPerSec: kDefaultRate
         }
      ]
   };

   return kDefaultSettings;
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

   // only non-null if this proxy is the one with a lock on the PhysicalDevice
   parser: CytonParser | undefined | null;

   settingsFromLoad: IDeviceProxySettingsSys | undefined;

   /**
    * @returns if the device is sampling
    */
   get isSampling() {
      // need to reset this even if sampling stops because the device went bad
      return this.parser ? this.parser.isSampling() : false;
   }

   // pass null for PhysicalDevice when proxy created in absence of hardware
   constructor(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: PhysicalDevice | null,
      settings: IDeviceProxySettingsSys = getDefaultSettings()
   ) {
      /**
       * Any state within "settings" will be saved / loaded by the application.
       */
      // this.settings = {
      //    dataInStreams: []
      // };

      /**
       * outStreamBuffers
       *
       * After sampled data has been parsed, it needs to be written to these buffers.
       * There is a buffer for each device stream
       */
      this.outStreamBuffers = [];
      this.proxyDeviceSys = quarkProxy;
      this.physicalDevice = physicalDevice;
      this.parser = null; // only non-null if this proxy is the one with a lock on the PhysicalDevice
      this.lastError = null;
      this.settingsFromLoad = undefined;

      this.onError = this.onError.bind(this);

      this.initializeSettings(settings);
   }

   clone(quarkProxy: ProxyDeviceSys | null): IProxyDevice {
      return new ProxyDevice(quarkProxy, this.physicalDevice, this.settings);
   }

   release(): void {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.release();
      }
   }

   onError(err: Error): void {
      this.lastError = err;
      console.warn(err);
   }

   /**
    * Called for both new and existing recordings. Initialize all settings for this device that are
    * to be saved in the recording.
    *
    * @param settingsData The settings data JSON to initialize from.
    */
   initializeSettings(settingsData: IDeviceProxySettingsSys) {
      this.settings = getDefaultSettings();
      this.settings.dataInStreams = [];

      const defaultSettings = getDefaultSettings();

      const nStreams = settingsData.dataInStreams.length;

      for (let streamIndex = 0; streamIndex < nStreams; ++streamIndex) {
         const defaultStreamSettingsData =
            defaultSettings.dataInStreams[streamIndex];

         const streamSettingsData = settingsData.dataInStreams[streamIndex];

         // if multiple streams share the hardware input they should reference the same InputSettings object
         const inputIndex = streamIndex; // default to 1 to 1
         const streamSettings = new StreamSettings(
            this,
            streamIndex,
            inputIndex,
            defaultStreamSettingsData
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
            new DeviceStreamConfigurationImpl()
         );
      }
   }

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
   setPhysicalDevice(physicalDevice: PhysicalDevice) {
      this.physicalDevice = physicalDevice;

      // If the hardware capabilities have changed, this is where the process
      // to translate from existing settings is performed.
      // Where hardware capabilities are reduced, the existing settings should
      // be left alone (in case original hardware comes back in future).
      // e.g. set hwSupport = false on the relevant setting.

      // Create the settings structure, copying our saved settings info into it.
      this.settingsFromLoad && this.initializeSettings(this.settingsFromLoad);

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
      this.settingsFromLoad = settings;

      // Create the settings structure, copying our saved settings info into it.
      this.initializeSettings(this.settingsFromLoad);

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
    * Called from Quark to allow this proxy to communicate with the device
    *
    * @returns if operation succeeded
    */
   connectToPhysicalDevice(): boolean {
      if (this.parser) {
         console.warn('connectToPhysicalDevice: already connected!');
         return true;
      }

      if (this.physicalDevice) {
         this.parser = this.physicalDevice.parser;
         return true;
      }
      this.lastError = new Error('physical device missing');
      return false;
   }

   /**
    * Called from Quark to prevent multiple proxies trying to communicate with the device at the same time.
    */
   disconnectFromPhysicalDevice(): void {
      this.parser = null; // drop our reference to the parser in the PhysicalDevice
   }

   /**
    * Called from Quark when user sets recording rate in single-rate mode.
    * If possible, set all this proxy's streams to closest possible rate <= samplesPerSec.
    */
   setAllChannelsSamplesPerSec(samplesPerSec: number): boolean {
      for (const stream of this.settings.dataInStreams) {
         (stream.samplesPerSec as any).value = samplesPerSec;
      }

      return true;
   }

   updateStreamSettings(
      streamIndex: number,
      streamSettings: StreamSettings,
      streamConfig: Partial<IDeviceStreamConfiguration>
   ) {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.setupDataInStream(
            streamIndex,
            streamSettings,
            streamConfig,
            this.applyStreamSettingsToHW(streamIndex, streamSettings)
         );
      }
   }

   //TODO: pass the actual setting that changed
   // N.B. this is a curried function so it can be called by Quark on the main JS thread after
   // sampling has stopped, if needed.
   applyStreamSettingsToHW = (
      streamIndex: number,
      streamSettings: StreamSettings
   ) => (error: Error | null, type: any): void => {
      if (error) console.error(error);
      else if (type === SysStreamEventType.kApplyStreamSettingsToHardware) {
         //TODO: replace this console log with actually sending appropriate command(s) to the hardware
         console.log(
            'Apply stream settings to hardware for stream',
            streamIndex
         );
      }
   };

   /**
    * @param bufferSizeInSecs should be used to calculate the size in samples of the ring buffers
    * allocated for each output stream. Quark guarantees to remove samples from these buffers well
    * before they become full if they are of this length.
    *
    * @returns if the operation succeeded. If this returns false, the calling code could call
    * getLastError() to find out what's wrong.
    */
   prepareForSampling(bufferSizeInSecs: number): boolean {
      if (!this.parser || !this.physicalDevice) return false; // can't sample if no hardware connection

      // create array of StreamBuffers (each with a streamIndex property) for each enabled stream.
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

      // set this proxy device as the sampling proxy
      this.parser.setProxyDevice(this);

      return true;
   }

   /**
    * Called from Quark. Device command to start sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStarted) needs to be called on the
    * ProxyDeviceSys
    *
    * @returns if device successfully started to sample
    */
   startSampling(): boolean {
      if (!this.parser) return false; // can't sample if no hardware connection

      return this.parser.startSampling();
   }

   /**
    * Called from Quark. Device command to stop sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStopped) needs to be called on the
    * ProxyDeviceSys
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
   // if this returns false, the calling code could call getLastError() to find out what's wrong
   cleanupAfterSampling(): boolean {
      this.outStreamBuffers = [];
      return true;
   }

   onSamplingStarted(): void {
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStarted,
            this.getDeviceName()
         );
   }

   onSamplingStopped(errorMsg: string): void {
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStopped,
            this.getDeviceName(),
            errorMsg
         );
   }

   /**
    * ProxyDeviceSys needs to be notified when samples are parsed and written to the outStreamBuffers.
    * This is done by calling samplingUpdate(inOutIndices) on the ProxyDeviceSys, where inOutIndices
    * is an array of the write pointers in the outStreamBuffers.
    */
   onSamplingUpdate(): void {
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
   // While worker support for devices is in development.
   runOnMainThread = true;

   constructor() {
      this.checkDeviceIsPresent = this.checkDeviceIsPresent.bind(this);
   }

   onError(err: Error): void {
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
   release(): void {}

   /**
    * @returns the name of the class of devices
    */
   getDeviceClassName(): string {
      return 'OpenBCI';
   }

   /**
    * @returns a GUID to identify this object
    */
   getClassId(): string {
      return deviceClassId;
   }

   /**
    * @returns a TDeviceConnectionType that defines the connection type.
    * ie. USB, serial etc.
    */
   getDeviceConnectionType(): any {
      return TDeviceConnectionType.kDevConTypeSerialPort;
   }

   // This is the method that will be called when integration tests are running.
   getDeviceConnectionTypeTEST(): any {
      return TDeviceConnectionType.kDevConTypeMockSerialPortForTesting;
   }

   makePhysicalDevice(
      deviceConnection: DuplexDeviceConnection,
      versionInfo: string
   ): PhysicalDevice {
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
         'OpenBCI V3 8-16 channel\n\
         On Board ADS1299 Device ID: 0x3E\n\
         LIS3DH Device ID: 0x33\n\
         Firmware: v3.1.0\n\
         '
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
      callback: (error: Error | null, device: OpenPhysicalDevice | null) => void
   ): void {
      const vid = deviceConnection.vendorId.toUpperCase();
      const pid = deviceConnection.productId.toUpperCase();

      if (
         vid !== '0403' ||
         pid !== '6015' ||
         deviceConnection.manufacturer !== 'FTDI'
      ) {
         callback(null, null); // Did not find one of our devices on this connection
         return;
      }

      // Give up if device is not detected within the timeout period
      const kTimeoutms = 3000; // Time for device to reboot and respond
      const devStream = new DuplexStream(deviceConnection);

      deviceConnection.setOption({ baud_rate: 115200 });

      //node streams default to 'utf8' encoding, which most devices won't understand.
      //With 'utf8' encoding, non-ascii chars, such as:
      //devStream.write('\xD4\x02\x02\xD4\x76\x0A\x62');
      //could be expanded into multiple bytes, so we use 'binary' instead.
      devStream.setDefaultEncoding('binary');

      // connect error handler
      devStream.on('error', (err: Error) => {
         console.log(err); // errors include timeouts
         devStream.destroy(); // stop 'data' and 'error' callbacks
         callback(err, null); // errors include timeouts
      });

      const deviceClass = this;
      let resultStr = '';
      // connect data handler
      devStream.on('data', (newBytes: Buffer) => {
         const newStr = newBytes.toString();
         resultStr += newStr;
         // See if we got '$$$'
         const endPos = resultStr.indexOf('$$$');
         if (endPos !== -1) {
            const startPos = resultStr.indexOf('OpenBCI');
            if (startPos >= 0) {
               // We found an OpenBCI device
               devStream.destroy(); // stop 'data' and 'error' callbacks

               const versionInfo = resultStr.slice(startPos, endPos);
               const physicalDevice = new PhysicalDevice(
                  deviceClass,
                  deviceConnection,
                  versionInfo
               );
               callback(null, physicalDevice);
            }
         }
      });

      // Give up if device is not detected within the timeout period
      devStream.setReadTimeout(kTimeoutms);

      // Tell the OpenBCI device to reboot and emit its version string.
      devStream.write('v');
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
   ): IProxyDevice {
      return new ProxyDevice(quarkProxy, physicalDevice as PhysicalDevice);
   }

   indexOfBestMatchingDevice(
      descriptor: OpenPhysicalDeviceDescriptor,
      availablePhysDevices: OpenPhysicalDeviceDescriptor[]
   ): number {
      console.log(
         'OpenBCI.indexOfBestMatchingDevice called',
         descriptor,
         availablePhysDevices
      );
      return 0;
   }
}

module.exports = {
   getDeviceClasses() {
      return [new DeviceClass()];
   }
};
