import {
   ProxyDeviceSys,
   OpenPhysicalDevice,
   IProxyDevice,
   IDeviceProxySettingsSys,
   StreamRingBuffer,
   IDeviceSetting,
   IDeviceInputSettingsSys,
   UnitPrefix,
   IDeviceStreamApi,
   DeviceValueType,
   IDeviceStreamApiImpl,
   IDeviceStreamConfiguration,
   UnitsInfo,
   SysStreamEventType,
   DeviceEvent,
} from '../../../public/device-api';

import { UnitsInfoImpl } from '../../../public/device-units';
import { Setting } from '../../../public/device-settings';
import { StreamRingBufferImpl } from '../../../public/stream-ring-buffer';
import { Parser } from '../../../public/packet-parser';
import { PhysicalDevice } from '../../../public/arduino-physical-device';
import { 
   kEnableLogging,
   kStreamNames 
} from './Teensy_4_1';

const kMinOutBufferLenSamples = 1024;

const kSettingsVersion = 1;

export const kSampleRates = [100.0];

// This needs to match the default rate in the hardware after it reboots
export const kDefaultSamplesPerSec = kSampleRates[0];

const kDefaultEnabled: IDeviceSetting = {
   settingName: 'Enabled',
   value: true,
   options: [
      { value: true, display: new Boolean(true).toString() },
      { value: false, display: new Boolean(false).toString() },
   ],
};

const kDefaultDisabled: IDeviceSetting = {
   settingName: 'Disabled',
   value: false,
   options: [
      { value: true, display: new Boolean(true).toString() },
      { value: false, display: new Boolean(false).toString() },
   ],
};

const kDefaultDecimalPlaces = 3;

const posFullScaleVAtGain = 3.3;

// Normally need various versions of this, including a default. See ArduinoRoundTrip.ts
const kUnitsForGain = new UnitsInfoImpl(
   'V', //unit name
   UnitPrefix.kMilli, //unit prefix
   kDefaultDecimalPlaces,
   // Unit conversion
   posFullScaleVAtGain, //maxInPrefixedUnits
   //maxInADCValues
   0x7fff, // based on 0x7fff for 16 bit(0x7fffff when we switch to 24 bit support)
   -posFullScaleVAtGain, //minInPrefixedUnits
   -0x7fff, //-0x7fff, //minInADCValues
   // should correspond to guide lines but don't work yet.
   0x7fff * 1.5, //maxValidADCValue
   -0x7fff * 1.5 //minValidADCValue
);

const kDefaultInputSettings: IDeviceInputSettingsSys = {
   range: {
      settingName: 'Range',
      value: kUnitsForGain.maxInPrefixedUnits,
      options: [
         {
            value: kUnitsForGain.maxInPrefixedUnits,
            display: kUnitsForGain.rangeDisplayString,
         },
      ],
   },
};

const kDefaultRate: IDeviceSetting = {
   settingName: 'Rate',
   value: kDefaultSamplesPerSec,
   options: [
      {
         value: kSampleRates[0],
         display: kSampleRates[0].toString() + ' Hz',
      },
   ],
};

export function getDefaultSettings(nStreams: number) {
   const kDefaultSettings = {
      version: kSettingsVersion,
      dataInStreams: kStreamNames.slice(0, nStreams).map(() => ({
         enabled: kDefaultEnabled,
         inputSettings: kDefaultInputSettings,
         samplesPerSec: kDefaultRate,
      })),
   };
   return kDefaultSettings;
}

function getDefaultDisabledStreamSettings() {
   const result = {
      enabled: kDefaultDisabled,
      inputSettings: kDefaultInputSettings,
      samplesPerSec: kDefaultRate,
   };
   return result;
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

      //enabled by default for now
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
               unitsInfo: kUnitsForGain,
            });

            return newValue;
         }
      );

      //Next input setting
   }
}

class DeviceStreamConfiguration implements IDeviceStreamConfiguration {
   unitsInfo: UnitsInfo;

   // TODO, explain these parameters
   constructor(posFullScaleV: number = 1, public dataFormat = 0) {
      this.unitsInfo = kUnitsForGain;
   }
}

enum ParserState {
   kUnknown,
   kIdle,
   kStartingSampling,
   kLookingForPacket,
   kSampling,
   kError,
}

export class ProxyDevice implements IProxyDevice {
   // TODO: should settings be in the interface? Seems very fundamental and
   // IDeviceProxySettingsSys is in the interface but not used elsewhere.
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
      if (kEnableLogging) {
         console.log('ProxyDevice initializing settings');
      }
      this.initializeSettings(settings);
   }

   release(): void {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.release();
      }
   }

   /**
    * Called for both new and existing recordings. Initialize all settings
    * for this device that are to be saved in the recording.
    *
    * @param nStreams The number of default streams to initialize for.
    */
   initializeSettings(settingsData: IDeviceProxySettingsSys) {
      const nDefaultStreams = this.physicalDevice
         ? this.physicalDevice.numberOfChannels
         : settingsData.dataInStreams.length;
      const defaultSettings = getDefaultSettings(nDefaultStreams);
      this.settings = getDefaultSettings(nDefaultStreams);
      this.settings.dataInStreams = [];

      const nDeviceStreams = this.physicalDevice
         ? this.physicalDevice.getNumberOfAnalogStreams()
         : 0;

      const nSettingsStreams = settingsData.dataInStreams.length;
      const nStreams = Math.max(nSettingsStreams, nDeviceStreams);

      if (kEnableLogging) {
         console.log('nStreams =', nStreams);
      }

      const defaultDisabledStreamSettings = getDefaultDisabledStreamSettings();

      // Ensure the settings have the correct number of data in streams for the current physical
      // device. This logic is complicated by the fact we support physical devices having different
      // stream counts (e.g. different numbers of inputs).
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

   //This is a curried function so it can be called by Quark on the main JS thread after sampling has stopped, if needed.
   applyStreamSettingsToHW = (
      streamIndex: number,
      streamSettings: StreamSettings
   ) => (error: Error | null, type: SysStreamEventType): void => {
      if (error) console.error(error);
      else if (type === SysStreamEventType.kApplyStreamSettingsToHardware) {
         // if (this.parser) {
         //    this.parser.setSamplesPerSec(
         //       Number(streamSettings.samplesPerSec.value)
         //    );
         //    this.parser.setGain(
         //       streamIndex,
         //       Number(streamSettings.inputSettings.range.value)
         //    );
         // }
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
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStarted,
            this.getDeviceName()
         );
      }
   }

   onSamplingStopped(errorMsg: string) {
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
