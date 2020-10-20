import {
   IProxyDevice,
   IDeviceProxySettingsSys,
   StreamRingBuffer,
   ProxyDeviceSys,
   IDeviceStreamConfiguration,
   SysStreamEventType,
   IDeviceSetting,
   DeviceEvent,
   TMessageFlags,
   MetaDataColors,
   IDeviceStreamApi,
   DeviceValueType,
   UnitsInfo,
   BlockDataFormat,
   IDeviceInputSettingsSys
} from '../../../public/device-api';
import { StreamRingBufferImpl } from '../../../public/stream-ring-buffer';
import { Setting } from '../../../public/device-settings';
import { kEnableLogging } from './enableLogging';
import { CommandPacketOp, Parser } from './parser';
import { PhysicalDevice } from './physicalDevice';
import {
   IProxyDeviceImpl,
   DeviceSettings,
   getDefaultDisabledStreamSettings,
   getDefaultSettings,
   kOrientationSamplesPerSec,
   kEnvironmentSamplesPerSec,
   kNumberOfOrientationSignals,
   getStreamName,
   kNumberOfOtherSignals,
   unitsFromPosFullScale,
   kSupportedEXGSamplesPerSec,
   findClosestSupportedRate,
   findClosestSupportedRateIndex,
   kAllEXGStreams,
   kDefaultNumExGSignals, kNumberEnvironmentSignals
} from './settings';
import { PacketType } from './utils';

const kMinOutBufferLenSamples = 1024;

// Currently we are only keeping the high 16 bits of the 24 bits (k16BitBlockDataFormat)
function getDataFormat() {
   return ~~BlockDataFormat.k16BitBlockDataFormat;
}

/**
 * The ProxyDevice object is created for each recording. Manages hardware settings and sampling.
 *
 * Implements {ProxyDevice}
 */
export class ProxyDevice implements IProxyDeviceImpl {
   /**
    * Any state within "settings" will be saved / loaded by the application.
    */
   settings: DeviceSettings;

   lastError: Error | null;

   /**
    * outStreamBuffers
    *
    * After sampled data has been parsed, it needs to be written to these buffers.
    * There is a buffer for each device stream
    */
   outStreamBuffers: StreamRingBuffer[];

   inputToStream?: number[];  //mapping from device inputs to device output streams

   physicalDevice: PhysicalDevice | null;
   proxyDeviceSys: ProxyDeviceSys | null;

   // only non-null if this proxy is the one with a lock on the PhysicalDevice
   parser: Parser | undefined | null;

   /**
    *
    * @param {ProxyDeviceSys} proxyDeviceSys Used to update Lightning if needed
    * @param {PhysicalDevice} physicalDevice Pass null for PhysicalDevice when proxy created in absence of hardware
    * @param {IDeviceProxySettingsSys} settings
    */

   constructor(
      proxyDeviceSys: ProxyDeviceSys | null,
      physicalDevice: PhysicalDevice | null,
      settings?: IDeviceProxySettingsSys
   ) {
      if (kEnableLogging) console.log('Constructing Proxy', settings);

      /**
       * Any state within "settings" will be saved / loaded by the application.
       */

      this.outStreamBuffers = [];
      this.proxyDeviceSys = proxyDeviceSys;
      this.physicalDevice = physicalDevice;
      this.parser = null; //Only non-null if this proxy is the one with a lock on the PhysicalDevice
      this.lastError = null;

      this.onError = this.onError.bind(this);
      this.applyStreamSettingsToHW = this.applyStreamSettingsToHW.bind(this);

      /**
       * Initialize the settings for the device to defaults or cloned settings passed in.
       * This does two things:
       * 1) Ensures any associated settings for the device (rates, gains) have
       *    helpful defaults.
       * 2) Sets up settings interactivity so that if a setting is changed by the
       *    user, the hardware can respond accordingly.
       *
       */
      this.initializeSettings(settings);
   }

   numberOfEXGStreams() {
      return this.settings.numberExgSignals;
   }

   isEXGStream(streamIndex: number) {
      return streamIndex < this.numberOfEXGStreams();
   }

   isOrientationStream(streamIndex: number) {
      return streamIndex >= this.numberOfEXGStreams() &&
         streamIndex < this.numberOfEXGStreams() + kNumberOfOrientationSignals;
   }

   streamToInput(streamIndex: number) {
      if (!this.inputToStream)
         return -1;
      return this.inputToStream.indexOf(streamIndex);
   }

   /**
    * Called for both new and existing recordings. Initialize all settings
    * for this device that are to be saved in the recording.
    */
   initializeSettings(settingsDataIn?: IDeviceProxySettingsSys) {
      const physicalDevice = this.physicalDevice;
      const nDeviceEXGInputs = physicalDevice
         ? physicalDevice.parser.numberExgSignals
         : kDefaultNumExGSignals;

      const nDeviceInputs = physicalDevice
         ? physicalDevice.getNumberOfAnalogStreams()
         : kDefaultNumExGSignals + kNumberOfOrientationSignals + kNumberEnvironmentSignals;

      const deviceSettingsIn = settingsDataIn as DeviceSettings;
      const nSettingsEXGSignals = deviceSettingsIn ? deviceSettingsIn.numberExgSignals : nDeviceEXGInputs;


      const defaultInputSettings = getDefaultSettings(this, nDeviceEXGInputs);
      const settingsData = deviceSettingsIn ? deviceSettingsIn : defaultInputSettings;

      this.settings = getDefaultSettings(this, nSettingsEXGSignals);

      this.settings.dataInStreams = [];
      this.inputToStream = [];  //mapping from device inputs to device output streams

      const defaultDisabledStreamSettings = getDefaultDisabledStreamSettings(
         this.settings,
         nSettingsEXGSignals
      );

      /**
       * Initialise inputToStream mapping
       * Two combinations that are not one to one: 
       *    1. 8 (Exg) stream settings with 4 (Exg) input device - tell Quark to disable streams [4,8)
       *    2. 4 (Exg) stream settings with 8 (Exg) input device - tell parser to disable inputs [4,8)
       * 
       * The inputToStream lookup table needs to be the same length as the number of inputs on the current 
       * device (16 or 20). Disabled inputs are marked by setting their inputToStream to -1.
       * 
      */

      let input = 0;
      for (let stream = 0; input < nDeviceEXGInputs; ++stream, ++input) {
         if (stream < nSettingsEXGSignals)
            this.inputToStream.push(stream);
         else
            this.inputToStream.push(-1); //case 2: tell parser to disable inputs [4,8)
      }

      for (let stream = nSettingsEXGSignals; input < nDeviceInputs; ++stream, ++input) {
         this.inputToStream.push(stream);
      }

      /* 
         Ensure the settings have the correct number of `dataInStreams` for 
         the current physical device. This logic is complicated by the fact we fake up physical devices having different stream counts for testing purposes.
         */
      for (let streamIndex = 0; streamIndex < settingsData.dataInStreams.length; ++streamIndex) {

         let streamSettingsData = settingsData.dataInStreams[streamIndex];
         const inputIndex = this.streamToInput(streamIndex);

         if (inputIndex < 0) {
            //Current hardware does not support this input
            streamSettingsData.enabled.value = false;
         } else {
            /* 
               Conversely, if stream has been disabled because we were mapped 
               to a device having fewer inputs, re-enable the stream by default
               so it will sample with the new device.
            */
            streamSettingsData.enabled = defaultInputSettings.dataInStreams[inputIndex].enabled;
         }

         const defaultStreamSettings =
            defaultInputSettings.dataInStreams[inputIndex] ||
            defaultDisabledStreamSettings[streamIndex];

         //If multiple streams share the same hardware input they should reference the same InputSettings object.
         //But this is not the case for Mentalab devices, so use a 1 to 1 mapping.
         const hwInputIndex = streamIndex;

         const streamSettings = new StreamSettings(
            this,
            streamIndex,
            hwInputIndex,
            defaultStreamSettings
         );
         streamSettings.inputSettings = new InputSettings(
            this,
            inputIndex,
            streamSettings,
            defaultStreamSettings.inputSettings
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

   /**
    * This updates the quark settings. ProxyDeviceSys is the connection to the
    * proxy device in Quark.
    *
    * Quark will then calls the function returned by applyStreamSettingsToHW,
    * which will send the same settings to the hardware
    *
    * @param {number} streamIndex
    * @param {StreamSettings} streamSettings
    * @param {Partial<IDeviceStreamConfiguration>} config
    * @param {boolean} restartAnySampling
    */
   updateStreamSettings(
      streamIndex: number,
      streamSettingsIn: StreamSettings | undefined,
      config: Partial<IDeviceStreamConfiguration>,
      restartAnySampling = true
   ) {
      if (this.proxyDeviceSys) {
         if (streamIndex === kAllEXGStreams) {
            //const nEXGStreams = this.parser.numberExgSignals;
            const nEXGStreams = this.numberOfEXGStreams();
            for (let i = 0; i < nEXGStreams; ++i) {
               const streamSettings = this.settings.dataInStreams[
                  i
               ] as StreamSettings;
               if (streamSettings)
                  this.proxyDeviceSys.setupDataInStream(
                     i,
                     streamSettings,
                     config,
                     this.applyStreamSettingsToHW(i, streamSettings),
                     restartAnySampling
                  );
               else
                  this.proxyDeviceSys.setupDataInStream(i); //disabled stream
            }
         } else if (streamSettingsIn) {
            this.proxyDeviceSys.setupDataInStream(
               streamIndex,
               streamSettingsIn,
               config,
               this.applyStreamSettingsToHW(streamIndex, streamSettingsIn),
               restartAnySampling
            );
         } else {
            this.proxyDeviceSys.setupDataInStream(streamIndex); //disabled stream
         }
      }
   }

   /**
    *
    * Note this is a curried function so it can be called by Quark on the main
    * JS thread after sampling has stopped, if needed.
    *
    * It sends new settings to the hardware.
    *
    * @param {number} streamIndex
    * @param {StreamSettings} streamSettings
    */
   applyStreamSettingsToHW(
      streamIndex: number,
      streamSettings: StreamSettings
   ) {
      return (error: Error | null, type: SysStreamEventType) => {
         if (kEnableLogging) console.log('Applying stream settings');
         if (error) {
            console.log('Error applying settings');
            console.error(error);
         } else if (
            type === SysStreamEventType.kApplyStreamSettingsToHardware
         ) {
            if (kEnableLogging)
               console.log(
                  'Apply stream settings to hardware for stream',
                  streamIndex
               );
            if (this.parser == null) {
               console.warn(
                  'Trying to change HW settings with no parser',
                  streamIndex
               );
               return;
            }

            const samplesPerSec = streamSettings.samplesPerSec.asNumber;

            // Only apply changes for one channel, since they are eeg-wide;
            if (streamIndex === 0) {
               const rateIndex = findClosestSupportedRateIndex(samplesPerSec);
               this.parser.sendCommand(
                  CommandPacketOp.setSampleRate,
                  kSupportedEXGSamplesPerSec.length - rateIndex
               );
            }
         }
      };
   }

   /**
    * Send settings for each stream to the hardware.
    * You can place any other custom hardware settings here.
    */
   applyAllSettingsToHardwareOnly() {
      if (kEnableLogging) console.log('Apply all settings to Hardware');

      //Example of how one might apply the stream settings to the hardware
      const nDeviceStreams = this.physicalDevice
         ? this.physicalDevice.getNumberOfAnalogStreams()
         : 0;

      for (let streamIndex = 0; streamIndex < nDeviceStreams; ++streamIndex) {
         const stream = this.settings.dataInStreams[streamIndex];
         if (stream)
            this.applyStreamSettingsToHW(streamIndex, stream as StreamSettings)(
               null,
               SysStreamEventType.kApplyStreamSettingsToHardware
            );
      }
   }

   /**
    * Called from the Refresh connection button in the Recording Devices item for this device.
    * @param argJson
    * @param callback
    */
   reopen = (
      argJson: {} | undefined,
      callback: (
         error: Error | null,
         result: { connectionError: boolean; deviceError: string } | null
      ) => void
   ): void => {
      if (!this.physicalDevice) {
         callback(new Error('No physical device!'), null);
         return;
      }
      if (!this.physicalDevice.deviceConnection) {
         callback(new Error('No physical device connection!'), null);
         return;
      }
      const connection = this.physicalDevice.deviceConnection;

      try {
         //this.physicalDevice.deviceConnection.reopen();
         if (connection.isOpen()) {
            connection.stop();
         }
      } catch (ex) {
         callback(null, { connectionError: true, deviceError: ex.message });
         return;
      }
      //The Mentalab BlueTooth serial port can fail to open if the open is too soon
      //after a close.
      setTimeout(() => {
         try {
            connection.start();
         } catch (ex) {
            callback(null, { connectionError: true, deviceError: ex.message });
         }
         let lastError = connection.lastError();
         if (connection.isOpen()) {
            if (lastError) connection.stop();
         } else {
            if (!lastError) {
               lastError = 'Connect failed to open for an unknown reason';
            }
         }
         callback(null, {
            connectionError: !!lastError,
            deviceError: lastError
         });
      }, 1200);
   };

   /**
    * Called from Quark when re-opening an existing recording to set the physical device
    * on this proxy (which can be read from disk), or when the user chooses to use a different device
    * (of the same class) with this proxy (i.e. settings).
    *
    * @param {OpenPhysicalDevice} physicalDevice the new PhysicalDevice that is in use
    * @returns if the operation succeeded
    */
   setPhysicalDevice(physicalDevice: PhysicalDevice) {
      if (kEnableLogging) console.log('Set physical device');
      this.physicalDevice = physicalDevice;
      //this.connectToPhysicalDevice();

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
    * @param {IDeviceProxySettingsSys} settings is the settings saved in the recording for this device.
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
   getLastError() {
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
   getNumberOfAnalogStreams() {
      return this.settings.dataInStreams.length;
   }

   /**
    * Called from Quark to allow this proxy to communicate with the device.
    * It is never called if another proxy is currently connected to the device.
    * It is called when the UI is trying to use the device, e.g. by changing a
    * setting or starting sampling.
    * This function should send the entire settings state to the hardware
    * because it is likely another proxy with different settings has been using the
    * hardware.
    *
    * @returns if operation succeeded
    */
   connectToPhysicalDevice() {
      if (kEnableLogging) console.log('Connect to physical device');
      if (kEnableLogging) console.log('connectToPhysicalDevice()');

      if (this.parser) {
         console.warn('connectToPhysicalDevice: already connected!');
         return true;
      }

      if (this.physicalDevice) {
         this.parser = this.physicalDevice.parser;
         this.parser.setProxyDevice(this, this.settings.numberExgSignals);
         if (kEnableLogging)
            console.log('Sending complete settings to hardware device');

         this.applyAllSettingsToHardwareOnly();
         return true;
      }
      this.lastError = new Error('physical device missing');
      return false;
   }

   /**
    * Called from Quark to prevent multiple proxies trying to communicate with the device at the same time.
    */
   disconnectFromPhysicalDevice() {
      if (this.parser) {
         this.parser.setProxyDevice(null);
         this.parser = null; // Drop our reference to the parser in the PhysicalDevice
      }
      if (kEnableLogging) console.log('Disconnect from physical device');
      this.parser = null; // Drop our reference to the parser in the PhysicalDevice
      if (kEnableLogging) console.log('disconnectFromPhysicalDevice()');
   }

   /**
    * Called from Quark when user sets recording rate in single-rate mode.
    * If possible, set all this proxy's streams to closest possible rate <= samplesPerSec.
    * @param {number} samplesPerSec
    */
   setAllChannelsSamplesPerSec(samplesPerSec: number) {
      if (kEnableLogging) console.log('Set all channels samples per second');

      const nEXGStreams = this.numberOfEXGStreams();

      for (let i = 0; i < this.settings.dataInStreams.length; i++) {
         if (i >= nEXGStreams + kNumberOfOrientationSignals) {
            this.settings.dataInStreams[
               i
            ].samplesPerSec.value = kEnvironmentSamplesPerSec;
         } else if (i >= nEXGStreams) {
            this.settings.dataInStreams[
               i
            ].samplesPerSec.value = kOrientationSamplesPerSec;
         } else {
            this.settings.dataInStreams[
               i
            ].samplesPerSec.value = findClosestSupportedRate(samplesPerSec);
         }
      }

      return true;
   }

   /**
    * @param {number} bufferSizeInSecs should be used to calculate the size in samples of the ring buffers allocated
    * for each output stream. Quark guarantees to remove samples from these buffers well before they
    * become full if they are of this length.
    *
    * @returns true if the operation succeeded. If this returns false, the calling code could call getLastError()
    * to find out what's wrong.
    */
   prepareForSampling(bufferSizeInSecs: number) {
      if (kEnableLogging) {
         console.log('Prepare for sampling');
         console.log(
            'Parser: ',
            this.parser,
            'Physical: ',
            this.physicalDevice
         );
      }
      if (!this.parser || !this.physicalDevice) return false; // Can't sample if no hardware connection

      // Create Array of StreamBuffers (each with a streamIndex property) for
      // each enabled stream.
      this.outStreamBuffers = [];
      let index = 0;
      if (kEnableLogging) console.log('Settings: ', this.settings);
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

      return true;
   }

   /**
    * Called from Quark. Device command to start sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStarted) needs to be called on the ProxyDeviceSys
    *
    * @returns if device successfully started to sample
    */
   startSampling() {
      if (kEnableLogging) console.log('Start sampling Proxy');
      if (!this.parser) return false; // Can't sample if no hardware connection

      return this.parser.startSampling();
   }

   /**
    * Called from Quark. Device command to stop sampling needs to be fired here.
    * If successful, onDeviceEvent(DeviceEvent.kDeviceStopped) needs to be called on the ProxyDeviceSys
    *
    * @returns if device successfully stopped sampling
    */
   stopSampling() {
      if (kEnableLogging) console.log('Stop sampling proxy');
      if (!this.parser) return false; // Can't sample if no hardware connection
      return this.parser.stopSampling();
   }

   /**
    * Called from Quark after sampling has finished. The outStreamBuffers should be reset here.
    * If this returns false, the calling code could call getLastError() to find out what's wrong
    * @returns true if cleanup succeeded
    */
   cleanupAfterSampling() {
      if (kEnableLogging) console.log('Cleanup after sampling proxy');
      this.outStreamBuffers = [];
      return true;
   }

   onSamplingStarted() {
      if (kEnableLogging) console.log('On sampling started');
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStarted,
            this.getDeviceName()
         );
   }

   onSamplingStopped(errorMsg: string) {
      if (kEnableLogging) console.log('On sampling stopped');
      if (this.proxyDeviceSys)
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStopped,
            errorMsg
         );
   }

   /**
    * ProxyDeviceSys needs to be notified when samples are parsed and written
    * to the outStreamBuffers.
    * This is done by calling samplingUpdate(inOutIndices) on the
    * ProxyDeviceSys, where inOutIndices is
    * an array of the write pointers in the outStreamBuffers.
    */
   onSamplingUpdate() {
      //console.log("On sampling update");
      if (this.proxyDeviceSys) {
         const inOutIndices = this.getOutBufferInputIndices();
         this.proxyDeviceSys.samplingUpdate(inOutIndices);
         //console.log(inOutIndices);
         this.setOutBufferOutputIndices(inOutIndices);
      }
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
    * @returns if the device is sampling
    */
   get isSampling() {
      // Need to reset this even if sampling stops because the device went bad
      return this.parser ? this.parser.isSampling() : false;
   }

   clone(quarkProxy: ProxyDeviceSys | null) {
      return new ProxyDevice(quarkProxy, this.physicalDevice, this.settings);
   }

   release() {
      if (kEnableLogging) console.log('Release proxy');
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.release();
      }
   }

   onError(err: Error) {
      if (kEnableLogging) console.log('On error proxy');
      this.lastError = err;
      console.warn(err);
   }

   onPacket(packetType: PacketType, buffer?: unknown) {
      if (packetType === PacketType.kMarker) {
         console.log('marker packet found');
         this.proxyDeviceSys &&
            this.proxyDeviceSys.onDeviceEvent(
               DeviceEvent.kDeviceEvent,
               this.getDeviceName(),
               `Mentalab marker ${buffer}`,
               {
                  flags: TMessageFlags.kMessageAddAnotation,
                  streamIndex: -1,
                  metadata: {
                     tags: [
                        { name: `${this.getDeviceName()}`, type: 'onMarker' }
                     ],
                     colorIndex: MetaDataColors.kLimeGreen
                  }
               }
            );
      }
   }
}

/**
 *
 * Implements {IDeviceStreamSettingsSys}
 */
class StreamSettings implements IDeviceStreamApi {
   enabled: Setting;
   samplesPerSec: Setting;
   streamName: string;
   inputSettings: InputSettings;
   mInputIndex: number;

   setValues(other: IDeviceStreamApi) {
      this.enabled.setValue(other.enabled);
      this.samplesPerSec.setValue(other.samplesPerSec);
      this.inputSettings.setValues(other.inputSettings);
   }

   /**
    *
    * @param {ProxyDevice} proxy
    * @param {number} streamIndex
    * @param {number} inputIndex
    * @param {IDeviceStreamSettingsSys} settingsData
    */
   constructor(
      proxy: ProxyDevice,
      streamIndex: number,
      inputIndex: number,
      settingsData: IDeviceStreamApi
   ) {
      const numberOfStreams = proxy.physicalDevice
         ? proxy.physicalDevice.numberOfChannels
         : undefined;
      this.streamName = getStreamName(streamIndex, numberOfStreams);

      this.mInputIndex = inputIndex;

      //enabled by default for now!
      this.enabled = new Setting(
         settingsData.enabled,
         (setting: Setting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(streamIndex, this, {}); //N.B. newValue has already been set on value prop
            return newValue;
         }
      );

      if (!proxy.settings.deviceSamplesPerSec) {
         proxy.settings.deviceSamplesPerSec = new Setting(
            settingsData.samplesPerSec,
            (setting: Setting, newValue: DeviceValueType) => {
               //Coerce the setting's internal value to the supported rate before updating Quark
               setting._value = findClosestSupportedRate(newValue as number);
               proxy.updateStreamSettings(kAllEXGStreams, this, {});
               return newValue;
            }
         );
      }

      if (proxy.isEXGStream(streamIndex)) {
         //These share the same setting
         this.samplesPerSec = proxy.settings.deviceSamplesPerSec as Setting;
      } else if (proxy.isOrientationStream(streamIndex)) {
         this.samplesPerSec = //kDefaultOrientationRate;
            new Setting(
               settingsData.samplesPerSec,
               (setting: Setting, newValue: DeviceValueType) => {
                  setting._value = kOrientationSamplesPerSec;
                  proxy.updateStreamSettings(streamIndex, this, {});
                  return newValue;
               }
            );
      } else {
         this.samplesPerSec = new Setting(
            settingsData.samplesPerSec,
            (setting: Setting, newValue: DeviceValueType) => {
               setting._value = kEnvironmentSamplesPerSec;
               proxy.updateStreamSettings(streamIndex, this, {});
               return newValue;
            }
         );
      }
   }

   //If multiple streams share the hardware input they should reference the same InputSettings object
   get inputIndex() {
      return this.mInputIndex;
   }
}

class DeviceStreamConfiguration implements IDeviceStreamConfiguration {
   unitsInfo: UnitsInfo;
   dataFormat: BlockDataFormat;
   constructor(posFullScaleV: number) {
      this.unitsInfo = unitsFromPosFullScale(posFullScaleV);
      this.dataFormat = getDataFormat();
   }
}

/* 
Note: could be renamed to 'InputConfigurations', or similar in future releases.

This is a configuration not a setting. This is the bare minimum that
must be implemented in the stream such as the range, the speed, and the units.
These are the things that Quark needs. It does not include device specific settings.
*/
class InputSettings implements IDeviceInputSettingsSys {
   range: Setting;

   setValues(other: IDeviceInputSettingsSys) {
      this.range.setValue(other.range);
   }

   /**
    *
    * @param {TestProxyDevice} proxy
    * @param {number} index
    * @param {StreamSettings} streamSettings
    * @param {IDeviceInputSettingsSys} inputSettingsData
    */
   constructor(
      proxy: ProxyDevice,
      index: number,
      streamSettings: StreamSettings,
      inputSettingsData: IDeviceInputSettingsSys
   ) {
      //Gain range setting
      this.range = new Setting(
         inputSettingsData.range,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(index, streamSettings, {
               unitsInfo: unitsFromPosFullScale(setting.value as number)
            });

            return newValue;
         }
      );

      //Next input setting
   }
}
