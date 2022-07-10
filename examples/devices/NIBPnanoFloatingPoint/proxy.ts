import {
   DeviceEvent,
   IDeviceSetting,
   IDeviceStreamConfiguration,
   IProxyDevice,
   MetaDataColors,
   OpenPhysicalDevice,
   ProxyDeviceSys,
   StreamRingBuffer,
   SysStreamEventType,
   TMessageFlags,
   TMessageSeverity,
   BlockDataFormat
} from '../../../public/device-api';
import { StreamRingBufferImpl } from '../../../public/stream-ring-buffer';
import {
   kMinOutBufferLenSamples,
   kDefaultNumOfChannels,
   NanoTxSampCmds,
   deviceName
} from './constants';
import { debugLog } from './enableLogging';
import { NanoParser } from './nanoParser';
import { PhysicalDevice } from './physicalDevice';
import {
   DeviceStreamConfigurationImpl,
   INIBPSettings,
   NIBPSettings,
   StreamSettings
} from './settings';
import { findClosestSupportedRate } from './utils';

/**
 * The ProxyDevice object is created for each recording. Manages hardware settings and sampling.
 */
export class ProxyDevice implements IProxyDevice {
   settings: NIBPSettings;
   outStreamBuffers: StreamRingBuffer[];
   proxyDeviceSys: ProxyDeviceSys | null;
   physicalDevice: PhysicalDevice | null;
   parser: NanoParser | null; //Only non-null if this proxy is the one with a lock on the PhysicalDevice
   lastError: Error | null;

   /**
    * @returns if the device is sampling
    */
   get isSampling() {
      // Need to reset this even if sampling stops because the device went bad
      return this.parser?.isSampling() ?? false;
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
      this.applyStreamSettingsToHW = this.applyStreamSettingsToHW.bind(this);

      settings = settings ?? NIBPSettings.defaults(this);
      debugLog('Constructing Proxy', settings);
      this.initializeSettings(settings);
   }

   //hcuZero callback is called on HCU zero button click from settings UI
   hcuZero(
      argJson: unknown,
      callback: (
         error: Error | null,
         result: { hcuStatus: string } | null
      ) => void
   ) {
      if (this.parser) {
         // When the zero process finishes, allow the parser to invoke our done callback.
         this.setHCUZeroCallback(callback);

         // ensure the 'error' from last HCU zero is cleared, if a HCU fails
         // it puts the nano into it's 'error' state and won't respond to future kHCUZero cmds
         // stupid firmware...
         this.parser.inStream.write(NanoTxSampCmds.kClearFirstError);

         // send first kHCUZero command then...
         this.parser.inStream.write(NanoTxSampCmds.kHCUZero);

         // wait 500ms, do it again. aparently the nano doesn't always respond to just 1,
         // this increases the reliablity at little cost
         setTimeout(() => {
            this.parser?.inStream.write(NanoTxSampCmds.kHCUZero), 500;
         });
      } else {
         throw new Error(
            'PROXY HCU can not be zeroed before connecting to the physical device'
         );
      }
   }

   //switchNow callback is called on switchNow button click from settings UI
   switchNow = (argJson: unknown, callback: () => void) => {
      this.parser?.inStream.write(NanoTxSampCmds.kSwitchCuffs);
      callback();
   };

   hcuZeroCallback?: (
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
         this.hcuZeroCallback?.(null, {
            hcuStatus: 'HCU zero timed out. Try again.'
         });
      }, kHCUZeroTimeoutMs);
   }

   clone(quarkProxy: ProxyDeviceSys) {
      return new ProxyDevice(quarkProxy, this.physicalDevice, this.settings);
   }

   release() {
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.release();
         this.proxyDeviceSys = null;
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
   initializeSettings(settingsData?: INIBPSettings) {
      debugLog('initializeSettings');
      const physicalDevice = this.physicalDevice;

      const nDeviceInputs = physicalDevice
         ? physicalDevice.getNumberOfAnalogInputs()
         : kDefaultNumOfChannels;

      this.settings = NIBPSettings.defaults(this);
      this.settings.dataInStreams = [];
      this.settings.assign(settingsData as NIBPSettings);

      const defaultSettings = NIBPSettings.defaults(this);
      settingsData = settingsData ?? defaultSettings;

      for (let streamIndex = 0; streamIndex < nDeviceInputs; ++streamIndex) {
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
            new DeviceStreamConfigurationImpl(streamIndex),
            true
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
    */
   updateStreamSettings(
      streamIndex: number,
      streamSettings: StreamSettings,
      config: Partial<IDeviceStreamConfiguration>,
      restartAnySampling = true
   ) {
      this.proxyDeviceSys?.setupDataInStream(
         streamIndex,
         streamSettings,
         config,
         this.applyStreamSettingsToHW(streamIndex, streamSettings),
         restartAnySampling
      );
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
      return (error: Error | null, type: any) => {
         if (error) console.error(error);
         else if (type === SysStreamEventType.kApplyStreamSettingsToHardware) {
            // This device doesn't have any stream specific settings
            // to change in hardware
         }
      };
   }

   getOutBufferInputIndices() {
      return Int32Array.from(this.outStreamBuffers, (buf) => buf.inIndex);
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
      debugLog('setPhysicalDevice()');
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
   setSettings(settings: INIBPSettings) {
      debugLog('ProxyDevice.setSettings()');
      // Create the settings structure, copying our saved settings info into it.
      this.initializeSettings(settings);

      return true;
   }

   /**
    * Called from Quark when user sets recording rate in single-rate mode.
    * If possible, set all this proxy's streams to closest possible rate <= samplesPerSec.
    */
   setAllChannelsSamplesPerSec(samplesPerSec: number) {
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
      return this.lastError?.message ?? '';
   }

   /**
    * Called from Quark. Only returns device name if proxy has
    * access to PhysicalDevice
    *
    * @returns device name
    */
   getDeviceName() {
      return this.physicalDevice?.getDeviceName() ?? '';
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
         this.parser.setProxyDevice(this);

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
   prepareForSampling(
      bufferSizeInSecs: number,
      streamDataFormats: BlockDataFormat[]
   ) {
      if (!this.parser || !this.physicalDevice) return false; // Can't sample if no hardware connection

      // Show user a warning, allowing them to cancel sampling.
      if (this.proxyDeviceSys) {
         this.proxyDeviceSys.onDeviceEvent(
            DeviceEvent.kDeviceStartSamplingUserQuery,
            deviceName,
            'Sampling will inflate finger cuffs. They can be damaged if inflated while empty.',
            {
               onceOnly: 'check-finger-cuffs',
               severity: TMessageSeverity.kMessageWarn
            }
         );
      }

      // This shouldn't really happen if things are coded correctly
      if (this.settings.dataInStreams.length !== streamDataFormats.length) {
         console.warn(
            `Setting and Configuration mismatch: 
         there are` +
               this.settings.dataInStreams.length +
               ` stream settings and ` +
               streamDataFormats.length +
               ` configuration data formats`
         );

         return false;
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
               new StreamRingBufferImpl(
                  index,
                  nSamples,
                  streamDataFormats[index]
               )
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
    * Display error pop-up
    * @param message warning message to be annoatated
    */
   displayWarn(message: string, onceOnlyId?: string, showPopUp = false) {
      if (!this.parser) return;

      this.addAnnotation(message, MetaDataColors.kColorWarning);

      if (showPopUp) {
         this.proxyDeviceSys?.onDeviceEvent(
            DeviceEvent.kDeviceEvent,
            this.getDeviceName(),
            message,
            {
               flags: TMessageFlags.kMessageDeviceError,
               severity: TMessageSeverity.kMessageWarn,
               onceOnly: onceOnlyId
            }
         );
      }
   }

   /**
    * Display error pop-up
    * @param message error message to be annotated
    */
   displayError(message: string, forceStop = true, onceOnlyId?: string) {
      if (!this.parser) return;

      this.addAnnotation(message, MetaDataColors.kColorError);

      this.proxyDeviceSys?.onDeviceEvent(
         DeviceEvent.kDeviceEvent,
         this.getDeviceName(),
         message,
         {
            flags: forceStop
               ? TMessageFlags.kMessageForceStop
               : TMessageFlags.kMessageQueryStop,
            severity: TMessageSeverity.kMessageError,
            onceOnly: onceOnlyId
         }
      );
   }

   /**
    * Add annotation to a channel
    * @param message Message to be add to annotation
    * @param streamIndex Targeted stream index
    */
   addAnnotation(
      message: string,
      color: MetaDataColors = MetaDataColors.kLimeGreen,
      streamIndex?: number
   ) {
      const stream = streamIndex !== undefined ? streamIndex : 0;
      this.proxyDeviceSys?.onDeviceEvent(
         DeviceEvent.kDeviceEvent,
         this.getDeviceName(),
         message,
         {
            flags: TMessageFlags.kMessageAddAnotation,
            streamIndex: stream, // annotation on first device channel
            metadata: {
               tags: [{ name: `${this.getDeviceName()}`, type: 'onStart' }],
               colorIndex: color
            }
         }
      );
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
