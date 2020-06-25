/**
 * Example device plugin based on the OpenBCI Cyton protocol.
 *  - Samples in Lightning using fake generated data
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
} from '../../public/device-api';

import { Setting } from '../../public/device-settings';

import { UnitsInfoImpl, UnitsInfo16Bit } from '../../public/device-units';

import { DuplexStream } from '../../public/device-streams';

import { StreamRingBufferImpl } from '../../public/stream-ring-buffer';

// Imported libs set in getDeviceClass(libs) in module.exports below
// obtained from quark-enums
type Enum = { [key: string]: number };

const kSettingsVersion = 1;

const kDataFormat = ~~BlockDataFormat.k16BitBlockDataFormat; // For now!

const kSampleRates = [16000.0, 8000.0, 4000.0, 2000.0, 1000.0, 500.0, 250.0];
const kDefaultSamplesPerSec = 250;

const kMinOutBufferLenSamples = 1024;

const kDefaultDecimalPlaces = 3;

// We implement a subset of the OpenBCI Cyton gains for demo purposes.
// From http://www.ti.com/lit/ds/symlink/ads1299.pdf
// 1 LSB = (2 × VREF / Gain) / 2^24 = +FS / 2^23
// VREF = 4.5 V
// Currently we are only keeping the high 16 bits of the 24 bits (k16BitBlockDataFormat)

const posFullScaleVAtGain1x = 4.5;

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

const kStreamNames = [
   'Serial Input 1',
   'Serial Input 2',
   'Serial Input 3',
   'Serial Input 4'
];

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
   deviceConnection: DuplexDeviceConnection;
   parser: Parser;
   numberOfChannels: number;

   constructor(
      private deviceClass: DeviceClass,
      deviceConnection: DuplexDeviceConnection
   ) {
      this.deviceConnection = deviceConnection;
      this.numberOfChannels = kStreamNames.length;
      this.serialNumber = `ADI-SerialSettings-123`;

      const inStream = new DuplexStream(this.deviceConnection);
      this.parser = new Parser(inStream);
      this.deviceName = deviceClass.getDeviceClassName() + ' Device';
   }

   release() {
      if (this.deviceConnection) {
         this.deviceConnection.onStreamDestroy();
         this.deviceConnection.release();
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
         deviceId: this.serialNumber || this.deviceConnection.devicePath
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

class StreamSettings implements IDeviceStreamApi {
   enabled: Setting;
   samplesPerSec: Setting;
   streamName: string;
   inputSettings: InputSettings;

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

/**
 * An object that handles parsing of data returned from the example device.
 * Note that this is device-specific and will need to be changed for any other device.
 */
class Parser {
   static kPacketSizeBytes = 33;

   state: ParserState = ParserState.kUnknown;
   lastError = '';
   bytesInPacket: number;
   packet: Buffer;
   expectedSampleCount: number; // is one byte (0 - 255)
   samplesPerSec: number;

   proxyDevice: ProxyDevice | null = null;

   incrementExpectedSampleCount() {
      this.expectedSampleCount++;
      this.expectedSampleCount &= 255;
      ++gSampleCountForTesting;
   }

   constructor(public inStream: IDuplexStream) {
      this.samplesPerSec = kDefaultSamplesPerSec;
      this.bytesInPacket = 0;
      this.packet = Buffer.alloc(Parser.kPacketSizeBytes);
      this.expectedSampleCount = 0;

      //node streams default to 'utf8' encoding, which most devices won't understand.
      //With 'utf8' encoding, non-ascii chars, such as:
      //devStream.write('\xD4\x02\x02\xD4\x76\x0A\x62');
      //could be expanded into multiple bytes, so we use 'binary' instead.
      this.inStream.setDefaultEncoding('binary');

      this.inStream.on('error', this.onError);
      // do we want to do this here? (switches stream into flowing mode).
      this.inStream.on('data', this.onData);
   }

   isSampling(): boolean {
      return ParserState.kIdle < this.state && this.state < ParserState.kError;
   }

   onError = (err: Error) => {
      this.lastError = err.message;
      console.warn(err);
   };

   setProxyDevice(proxyDevice: ProxyDevice) {
      this.proxyDevice = proxyDevice;
   }

   setSamplesPerSec(samplesPerSec: number): number {
      //All input samples are at the same rate
      if (this.samplesPerSec === samplesPerSec) {
         return samplesPerSec;
      }
      const index = kSampleRates.indexOf(samplesPerSec);
      if (index >= 0) {
         const char = '0123456'.charAt(index);
         this.inStream.write('~' + char);
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
            'x' + inputChar + '0' + gainChar + '0' + '1' + '1' + '0' + 'X';
         this.inStream.write(commandStr);
      }
   }

   startSampling(): boolean {
      if (!this.inStream || !this.proxyDevice) {
         return false;
      }

      this.inStream.write('b'); // OpenBCI begin sampling command
      this.state = ParserState.kStartingSampling;
      this.expectedSampleCount = 0;
      //this.bytesInPacket = 0;
      return true;
   }

   stopSampling(): boolean {
      this.state = ParserState.kIdle;
      if (!this.inStream) return false; // Can't sample if no hardware connection

      this.inStream.write('s'); // OpenBCI begin sampling command
      if (this.proxyDevice) this.proxyDevice.onSamplingStopped(''); // Normal user stop
      return true;
   }

   processPacket(data: Buffer): boolean {
      const kStartOfDataIndex = 2;

      let lostSamples = 0;

      if (data[0] != 0xa0 || (data[32] & 0xf0) != 0xc0) {
         this.lastError = 'Cyton packet out of sync';
         console.warn(this.lastError);
         return false; //not in synch
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
            for (let streamIndex = 0; streamIndex < nStreams; ++streamIndex) {
               // Don't produce data for disabled streams.
               if (
                  !this.proxyDevice.settings.dataInStreams[streamIndex].enabled
                     .value
               )
                  continue;

               outStreamBuffers[streamIndex].writeInt(0x8000); //Insert 'out of range' values
            }
         }
         this.expectedSampleCount = data[1]; //resynch
      }

      let byteIndex = kStartOfDataIndex;
      for (
         let streamIndex = 0;
         streamIndex < nStreams;
         ++streamIndex, byteIndex += 3
      ) {
         // Don't produce data for disabled streams.
         if (
            !this.proxyDevice.settings.dataInStreams[streamIndex].enabled.value
         )
            continue;

         // The OpenBCI Cyton format is big endian 24 bit.
         // See http://docs.openbci.com/Hardware/03-Cyton_Data_Format
         const value =
            (data[byteIndex] << 16) +
            (data[byteIndex + 1] << 8) +
            data[byteIndex + 2];

         const int16Val = value >> 8; // For now just taking the high 16 bits
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
         case ParserState.kIdle:
            return;

         case ParserState.kStartingSampling:
            this.state = ParserState.kLookingForPacket;
            this.expectedSampleCount = 0;
            if (this.proxyDevice) this.proxyDevice.onSamplingStarted();

         case ParserState.kLookingForPacket:
         case ParserState.kSampling:
            while (this.bytesInPacket) {
               // Handle partial packet left over from last onData()
               // Copy some new bytes into stored packet to try to get a complete packet
               const nToCopy = Math.min(
                  Parser.kPacketSizeBytes - this.bytesInPacket,
                  nBytes
               );
               newBytes.copy(
                  this.packet,
                  this.bytesInPacket,
                  inOffset,
                  inOffset + nToCopy
               );
               this.bytesInPacket += nToCopy;
               inOffset += nToCopy;
               if (this.bytesInPacket >= Parser.kPacketSizeBytes) {
                  //We have a full packet
                  if (
                     this.packet[0] === 0xa0 &&
                     this.processPacket(this.packet)
                  ) {
                     this.bytesInPacket = 0; //successfully processed all the bytes stored in this.packet
                     this.state = ParserState.kSampling;
                  } else {
                     //Search for packet start char, in the stored packet
                     this.state = ParserState.kLookingForPacket;
                     let startPos = this.packet[0] === 0xa0 ? 1 : 0; //Skip first byte if already checked
                     for (; startPos < this.bytesInPacket; ++startPos) {
                        if (this.packet[startPos] === 0xa0) {
                           break; //found a potential packet start byte
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
                        this.state = ParserState.kSampling;
                     } else {
                        this.bytesInPacket = 0; //scrap the saved bytes
                     }
                  }
               }
            } //while (this.bytesInPacket)

            //Handle newBytes
            while (nBytes - inOffset >= Parser.kPacketSizeBytes) {
               if (this.state === ParserState.kLookingForPacket) {
                  //Search for packet start char in the newBytes
                  for (; inOffset < nBytes; ++inOffset) {
                     if (newBytes[inOffset] === 0xa0) {
                        this.state = ParserState.kSampling;
                        break; //found possible start of packet
                     }
                  }
               }

               if (this.state === ParserState.kLookingForPacket) break; //done

               if (
                  !this.processPacket(
                     newBytes.slice(
                        inOffset,
                        (inOffset += Parser.kPacketSizeBytes)
                     )
                  )
               ) {
                  inOffset -= Parser.kPacketSizeBytes - 1; //Start searching from the 2nd byte in last packet
                  this.state = ParserState.kLookingForPacket;
               }
            } //while(nBytes - inOffset >= CytonParser.kPacketSizeBytes)

            break;
         case ParserState.kError:
            console.warn('Cyton parser: error state');
         default:
            console.warn('Cyton parser: unexpected state:', this.state);
      } //switch

      if (inOffset < nBytes) {
         //store partial packet
         if (nBytes - inOffset > Parser.kPacketSizeBytes)
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
   }; //onData
} //CytonParser

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
         value: kDefaultSamplesPerSec,
         display: kDefaultSamplesPerSec.toString() + ' Hz'
      },
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
   parser: Parser | null;

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

         // Use disabled settings if stream is beyond the end of the number stored
         // in the settings or is beyond the number supported by the current physical
         // device.
         if (
            !streamSettingsData ||
            streamIndex >= defaultSettings.dataInStreams.length
         ) {
            streamSettingsData = defaultDisabledStreamSettings;
         } else {
            // Conversely, if stream has been disabled because we were mapped to a device
            // having fewer inputs, re-enable the stream by default so it will sample
            // with the new device.
            streamSettingsData.enabled =
               defaultSettings.dataInStreams[streamIndex].enabled;
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
      this.parser = null; // Drop our reference to the parser in the PhysicalDevice
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
         if (stream && stream.enabled) {
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
}

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
      return 'SerialSettings';
   }

   /**
    * @returns a GUID to identify this object
    */
   getClassId() {
      // UUID generated using https://www.uuidgenerator.net/version1
      return 'e60ce0c8-b107-11ea-b3de-0242ac130004';
   }

   /**
    * @returns a TDeviceConnectionType that defines the connection type.
    * ie. USB, serial etc.
    */
   getDeviceConnectionType(): TDeviceConnectionType {
      return TDeviceConnectionType.kDevConTypeMockSerialPortForTesting;
   }

   static testDeviceIndexFromConnectionPath(devicePath: string): number {
      return parseInt(
         devicePath
            .substring('TestDevicePath_'.length)
            .replace(/(^\d+)(.+$)/i, '$1'),
         10
      );
   }

   devicePathIsOneOfOurs(devicePath: string): boolean {
      return devicePath.startsWith('TestDevicePath_0');
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
      if (!this.devicePathIsOneOfOurs(deviceConnection.devicePath)) {
         callback(null, null); // Did not find one of our devices on this connection
         return;
      }

      const kTimeoutms = /*this.loadTestDevice ? 50 : */ 10000; // Time for device to reboot and respond
      const devStream = new DuplexStream(deviceConnection);

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

      let resultStr = '';
      // connect data handler
      devStream.on('data', (newBytes: Buffer) => {
         const newStr = newBytes.toString();
         resultStr += newStr;
         // See if we got '$$$'
         const endPos = resultStr.indexOf('$$$');

         const testConnectionPrefixPos = resultStr.indexOf('{{TestDevicePath_');

         if (endPos !== -1 && testConnectionPrefixPos === 0) {
            // We found a test device
            devStream.destroy(); // stop 'data' and 'error' callbacks

            const physicalDevice = new PhysicalDevice(this, deviceConnection);

            callback(null, physicalDevice);
         }
      });

      // Give up if device is not detected within the timeout period
      devStream.setReadTimeout(kTimeoutms);
      deviceConnection.setOption({ baud_rate: 38400 });

      // Tell the device to reboot and emit its version string.
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
