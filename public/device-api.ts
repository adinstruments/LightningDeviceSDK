export const kInt32sPerTimePoint = 2; //Each TimePoint is a little endian 64 bit integer

export type TInt64 = Int32Array; //Of length 2 (Little endian)

export class TimePoint {
   localPreTimeTick: TInt64;
   remoteTimeTick: TInt64;
   localPostTimeTick: TInt64;

   constructor(other?: TimePoint) {
      this.localPreTimeTick = new Int32Array(2);
      this.remoteTimeTick = new Int32Array(2);
      this.localPostTimeTick = new Int32Array(2);
      if (other) {
         this.localPreTimeTick.set(other.localPreTimeTick);
         this.localPostTimeTick.set(other.localPostTimeTick);
         this.remoteTimeTick.set(other.remoteTimeTick);
      }
      //this.latestUSBFrame = 0xffff; //I.e. 16 bit -1, which is not a valid USB Frame number
   }
}

export class USBTimePoint extends TimePoint {
   remoteUSBSOFTimeTick: TInt64;
   latestUSBFrame: number;

   constructor(other?: USBTimePoint | TimePoint) {
      super(other);

      this.remoteUSBSOFTimeTick = new Int32Array(2);
      this.latestUSBFrame = -1;

      if (other && isUSBTimePoint(other)) {
         this.remoteUSBSOFTimeTick.set(other.remoteUSBSOFTimeTick);
         this.latestUSBFrame = other.latestUSBFrame;
      }
   }
   //this.latestUSBFrame = 0xffff; //I.e. 16 bit -1, which is not a valid USB Frame number
}

export function isUSBTimePoint(
   timePoint: TimePoint | USBTimePoint
): timePoint is USBTimePoint {
   return (timePoint as USBTimePoint).latestUSBFrame !== undefined;
}

export class FirstSampleRemoteTime {
   remoteFirstSampleTick: TInt64;

   constructor() {
      this.remoteFirstSampleTick = new Int32Array(2);
   }
}

export class Rational {
   //numerator and denominator should be integers
   constructor(public numerator: number, public denominator: number) {}
}

//Shared between Typescript and C++ (Quark and device firmware)
export enum ADIDeviceSynchModes {
   kDeviceSynchNone = 0 | 0,
   kDeviceSyncRoundTrip = 1 | 0,
   kDeviceSyncUSBFrameTimes = 2 | 0,
   kDeviceSynchUSBLocked = 4 | 0
}

//Form of JSON version/capabilities returned from device firmware in
//response to a version request command.
export interface IDeviceVersionInfo {
   deviceClass: string;
   deviceName?: string;
   version: string;
   numberOfChannels?: number;
   serialNumber?: string;
   deviceSynchModes?: ADIDeviceSynchModes;
}

//Shared between C++ and Typescript: see public/device-api.ts and libs/quark-sys/libs/QuarkCOMInterfaces/IADIDeviceTimeAsynch.h
export enum ADITimePointInfoFlags {
   kTPInfoDefault = 0 | 0,
   kDeviceSyncRoundTrip = 1 | 0,
   kDeviceSyncUSBFrameTimes = 2 | 0,
   kDeviceSynchUSBLocked = 4 | 0
}

export class TimePointInfo {
   constructor(
      //The rate of the clock/timer in the device.
      //N.B. Currently only integer values are supported, i.e. denominator must equal 1.
      public remoteTicksPerSec: Rational,

      //Size of the remote time tick returned from the device in bits. E.g. 32 means the remote tick count
      //is a value wrapping from 2^32-1 to 0 (or equivalently +2^31-1 to -2^31.
      //This is used by Lightning to "uwrap" the reported remote device time into a 64 bit number.
      public remoteTicksValidBits: number,

      public flags: ADITimePointInfoFlags = ADITimePointInfoFlags.kTPInfoDefault
   ) {}
}
export * from './device-ui-api';

//see quark-sys\libs\QuarkCOMInterfaces\IOpenDeviceConnection.h for
//Quark c++ definition.
//Some connections may have empty strings for some of these properties
export interface DeviceConnectionInfo {
   devicePath: string;
   friendlyName: string;
   pnpId: string;
   vendorId: string;
   productId: string;
   manufacturer: string;
   serialNumber: string;
}

export enum TFlowControl {
   none = 0 | 0,
   software = 1 | 0,
   hardware = 2 | 0
}

export enum TParity {
   none = 0 | 0,
   odd = 1 | 0,
   even = 2 | 0
}

export enum TStopBits {
   one = 0 | 0,
   onepointfive = 1 | 0,
   two = 2 | 0
}

//See e.g. boost ASIO: /boost/asio/serial_port_base.hpp
export interface SerialPortOptions {
   baud_rate?: number;
   flow_control?: TFlowControl; //default: none
   parity?: TParity; //default: none
   stop_bits?: TStopBits; //default: one
   character_size?: number; //default: 8
}

export interface DeviceConnection extends DeviceConnectionInfo {
   start(): boolean; //returns true if started or already running
   stop(): void;
   setReadHandler(
      callback: (error: Error | null, buffer: Int8Array | null) => void
   ): void;
   onStreamDestroy(): void; //reset the callback
   release(): void;
   setOption(options: SerialPortOptions): void;
   getLocalSteadyClockTickNow(timeTick: TInt64): void;
   isOpen(): boolean;
   lastError(): string;
   isReceivingData(): boolean; //true if received data within the last 200 ms
}

export interface DuplexDeviceConnection extends DeviceConnection {
   //callBack returns with error === null if write succeeded
   //setWriteHandler( callBack:(error: Error | null) => void): void;
   write(buffer: Buffer, callback: (error?: Error) => void): void;
}

export interface IStreamBuffer {
   writeInt(value: number): boolean;
}

export interface StreamRingBuffer {
   //public JS interface
   indexInDevice: number;
   count(): number;
   freeSpace(): number;
   writeInt(value: number): boolean;

   //Returns true if whole chunk written
   writeAll(chunk: Int16Array): boolean;

   //Returns number of samples written
   //writeSome(chunk: Int16Array, start: number, end: number): number;

   //Internal implementation
   //ringBuffer: Int16Array;
   ringBufferBuffer: SharedArrayBuffer; //Memory under ringBuffer (shared with Quark)
   inIndex: number; //read by Quark to see if data is available
   outIndex: number; //written by Quark when data is read from buffer.
}

// Allows it to be inherited from.
export type HierarchyOfDeviceSettingsBase = HierarchyOfDeviceSettings | any;

export type DeviceProxyId = {
   className: string;
   classGuid: string;
   indexInClass: number;
};

export function proxyIdsAreEqual(a: DeviceProxyId, b: DeviceProxyId): boolean {
   return a.classGuid === b.classGuid && a.indexInClass === b.indexInClass;
}

export interface IDeviceProxySettingsSys extends HierarchyOfDeviceSettingsBase {
   version: number;
   dataInStreams: IDeviceStreamApi[];

   //Used if the all the streams with a variable sample rate have to sample at the same rate.
   deviceSamplesPerSec?: IDeviceSetting;
}

export type HierarchyOfDeviceSettings = { [key: string]: DeviceSettingsValue };

/**
 * Represents the possible types an object in the device settings can be.
 */
export type DeviceSettingsValue =
   | number
   | string
   | IDeviceSetting
   | { [key: string]: IDeviceSetting }
   | HierarchyOfDeviceSettings
   | HierarchyOfDeviceSettings[];

export type DeviceValueType = number | string | boolean;

export interface IDeviceSetting {
   settingName: string;
   value: DeviceValueType; //generally added using Object.defineProperty().
   display?: string;
   options: IDeviceOption[];

   /**
    * @prop controlType Indicates the type of control LabChart used to render
    * the parameter. Can be useful for making default UI decisions in Lightning.
    */
   controlType?: DeviceSettingControlType;

   /**
    * @prop hwSupport Does current hardware support this setting?
    *
    * Defaults to true (i.e. when undefined).
    */
   hwSupport?: boolean;

   /**
    * @prop staticFlags Flags common to all the settings of a particular type, e.g. whether
    *  or not the UI for the setting should be displayed by default.
    */
   staticFlags?: DeviceSettingStaticFlags;

   plSettingId?: number;
}

export interface IDeviceOption {
   value: DeviceValueType;
   display: string;

   // Some options have associated behaviours such as enabling / disabling other
   // UI elements. For example, Bio Amp's "DC" High pass setting hides the DC
   // Restore button and instead shows Zero.
   //
   // Originally added for the Digital NeuroAmp which hides the DC Restore
   // button using this mechanism.
   metadata?: DeviceOptionMetadataTypes;
}

export type DeviceOptionMetadataTypes = 'DisableDCControls' | 'EnableZero';

//Shared with Quark
export enum DeviceSettingStaticFlags { //: uint32_t
   kQSSFlagsNil = 0 | 0,
   kQSSHideByDefault = 0x80000000 | 0
}

//N.B. these must match the Control types embedded in Pod EPROM hardware
//Shared with Quark
export enum DeviceSettingControlType { // : int32
   kControlTypeUnknown = 0 | 0,
   kControlTypeMenu = 2 | 0,
   kControlTypeButton = 3 | 0,
   kControlTypeRadioButton = 4 | 0,
   kControlTypeCheckBox = 5 | 0,
   kControlTypeGainMenu = 31 | 0
}

export interface OpenPhysicalDeviceDescriptor {
   // MLHardwareDescriptor members:
   //
   // PowerLabType mType;
   // PowerLabTechnology mTechnology;
   // uint32 mInputs;
   // ADIConnectionType mConType;
   // PLHardwareDevice *mPowerLab;
   // ADI::String mConnectionName;
   // ADI::String mDeviceNameType;     //Last used hardware type name, e.g. 'PowerLab 2/20'.
   // ADI::String mDeviceNameCustom;   //User assigned hardware name, e.g. EGCPowerLab
   // ADI::String mPTreeStr;        //Future proofing file format - change to a wptree if new setting needs to be added

   deviceType: string;
   numInputs: number;

   // A unique identifier for this piece of hardware.
   deviceId: string;
}

export interface OpenPhysicalDevice {
   deviceConnection?: DuplexDeviceConnection;
   getDeviceName(): string;
   getNumberOfAnalogInputs(): number;
   getNumberOfAnalogStreams(): number;
   getDescriptor(): OpenPhysicalDeviceDescriptor;
   release?(): void;
}

export interface IDeviceStreamApi extends HierarchyOfDeviceSettingsBase {
   inputSettings: IDeviceInputSettingsSys;

   enabled: IDeviceSetting; //N.B. enabled.value is most likely what you need!

   samplesPerSec: IDeviceSetting;

   //isEnabled: boolean; //AKA this.enabled.value

   //Optional: index within this device of the input mapped to this stream.
   //Defaults to a 1:1 stream to input mapping within the device
   inputIndex?: number;

   /**
    * Optional setting for the index of physical input produced by the device to
    * be recorded into this stream.
    */
   inputId?: IDeviceSetting;
   streamName?: string;

   // The following are currently supplied by PowerLabs.
   userEnabled?: boolean;
   streamInDevice?: number;

   //Indicates whether or not Quark expects this stream to sample (mainly for testing)
   quarkStreamEnabled?: boolean;
}

export interface IDeviceStreamApiImpl extends IDeviceStreamApi {
   isEnabled: boolean; //getter returning this.enabled.value
}

export interface IDeviceSettingsApi extends HierarchyOfDeviceSettingsBase {}

export interface IDeviceInputSettingsSys {
   range: IDeviceSetting;

   // Standard Input Amp settings.
   Invert?: IDeviceSetting;
   ACCoupled?: IDeviceSetting;
   Differential?: IDeviceSetting;
   PosGrounded?: IDeviceSetting;
   MainsFilter?: IDeviceSetting;
   LPFilter?: IDeviceSetting;
   AntiAlias?: IDeviceSetting;

   // POD-specific settings
   Alarm?: IDeviceSetting;
   Zero?: IDeviceSetting;

   // Front-end specific
   HPFilter?: IDeviceSetting;
   RightLegDrive?: IDeviceSetting;
   HeadphoneOutput?: IDeviceSetting;
   EEGMode?: IDeviceSetting;
   MainsNotch?: IDeviceSetting;

   /**
    * e.g. 'Oximeter Pod' or undefined if a vanilla PowerLab input.
    */
   inputHWName?: string;
}

export type DeviceInputActionTypes =
   | 'EnterSamplingPreview'
   | 'ExitSamplingPreview'

   // GSR Amp
   | 'GSRHardwareZero'
   | 'GSRSubjectZero'

   // General Zeroing
   | 'BPZero' // Value will be either '0' or '1' depending on front-end

   // Bridge Amp
   | 'SetOffset'

   // BP Amp
   | 'SetLowLimit'

   // Bio Amp
   | 'BioAmpDCRestore';

export type DeviceInputStatusTypes =
   // GSR Amp
   | 'TextZero'
   | 'TextBPShowStatus'
   | 'BPShowStatus'

   // Bridge Amp
   | 'SetOffset'

   // BP Amp
   | 'SetLowLimit';

//Defined in libs\quark-sys\libs\LegacyInterfaces\idynidfact.h
const kDeviceConnectionTypeBase = 0x80230000 | 0;

//Defined in quark-sys\libs\QuarkCOMInterfaces\IOpenDeviceConnection.h
export enum TDeviceConnectionType {
   kDevConTypeSerialPort = kDeviceConnectionTypeBase,
   kDevConTypeMockSerialPortForTesting = kDeviceConnectionTypeBase + 1,
   kDevConTypeMockSerialPortsForTesting = kDeviceConnectionTypeBase + 2,
   kDevConTypeSerialOverBluetooth = kDeviceConnectionTypeBase + 3
}

//Defined in quark-sys\src\callback-and-wait.h
//Used to control the behavior of the Quark code calling methods on JS objects
export enum JsObjectAttr { //: int32_t
   kJsObjectAttrNil = 0 | 0,
   kJsSwallowJsExceptions = 1 | 0
}

//see quark-sys\libs\QuarkCOMInterfaces\IOpenDeviceConnection.h for
//Quark c++ definition (IJsDeviceClass)
export interface IDeviceClass {
   // By default, devices will run in a worker.
   // Temp: Provide option to run on main thread for developement.
   runOnMainThread?: boolean;
   attributes?: JsObjectAttr;

   getDeviceClassName(): string;

   //UUID generated using e.g. https://www.uuidgenerator.net/version1
   //returned as a string.
   getClassId(): string;

   getDeviceConnectionType(): TDeviceConnectionType;

   checkDeviceIsPresent(
      deviceInfo: DeviceConnection,
      callback: (error: Error | null, device: OpenPhysicalDevice | null) => void
   ): void;

   createProxyDevice(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: OpenPhysicalDevice | null
   ): IProxyDevice;

   release?(): void;

   /**
    * Optional. Called when ADI device tests are run to ensure large numbers of physical
    * devices do not accumulate across tests.
    */
   clearPhysicalDevices?(): void;

   /**
    * Called when deciding which physical device should be used for the specified
    * device proxy in a recording.
    *
    * @returns The index into the passed-in physical devices array of the best match, or -1
    * if no device is a good match. In this case, no device will be assigned to the proxy.
    */
   indexOfBestMatchingDevice(
      descriptor: OpenPhysicalDeviceDescriptor,
      availablePhysicalDevices: OpenPhysicalDeviceDescriptor[]
   ): number;
}

//The Quark part of the ProxyDevice
export interface ProxyDeviceSys {
   release(): void;

   // //Called from PrepareForSampling() tell Quark to get the proxy's ringbuffers and
   // //connect up the c++ side of them
   // setAnalogStreamRingBuffers(): Error;
   // getJSProxyDevice(): ProxyDevice;

   //In general, devices can have more or less output data streams than electrical inputs.
   // setupDataInStream(streamInDevice: number, /*inputIndex: number,*/ enabled: boolean,
   //    samplesPerSec: number, format: BlockDataFormat, unitsInfo: UnitsInfo): void;
   setupDataInStream(
      streamInDevice: number /*inputIndex: number,*/,
      settings?: IDeviceStreamApi,
      configuration?: Partial<IDeviceStreamConfiguration>,
      callback?: (error: Error | null, type: SysStreamEventType) => void,
      restartAnySampling?: boolean
   ): void;

   //onSamplingStarted(): void;

   //Call into Quark (OpenDeviceProxy) at about 20 Hz max to indicate new data is available
   samplingUpdate(bufferInputIndices: Int32Array): void;

   //Consider passing an error code as well so Quark can more easily determine what to
   //do if there is an error.
   //onSamplingStopped(errorMsg: string /*, errorCode: SamplingError*/): void;

   onDeviceEvent(
      event: DeviceEvent,
      deviceName: string,
      message?: string,
      options?: ISysEventOptions
   ): void;

   onRemoteTimeEvent(
      error: Error | null,
      timePoint: TimePoint | FirstSampleRemoteTime | USBTimePoint | null
   ): void;
}

//Data stream configuration information Quark looks for in the 
//configuration parameter passed to ProxyDeviceSys.setupDataInStream()
export interface IDeviceStreamConfiguration {
   dataFormat: BlockDataFormat;
   unitsInfo: UnitsInfo;
}

//Defined in libs\quark-sys\libs\LegacyInterfaces\idynidfact.h
const kBlockDataFormatBase = 0x80020000 | 0;

//Defined in libs\quark-sys\libs\LegacyDataInterfaces\IADIDataSink.h
export enum BlockDataFormat {
   k12BitBlockDataFormat = kBlockDataFormatBase | 0,
   k16BitBlockDataFormat = BlockDataFormat.k12BitBlockDataFormat + 1,
   k32BitBlockDataFormat = BlockDataFormat.k16BitBlockDataFormat + 1,
   kFloatBlockDataFormat = BlockDataFormat.k32BitBlockDataFormat + 1,
   kDoubleBlockDataFormat = BlockDataFormat.kFloatBlockDataFormat + 1
}

export interface UnitsInfo {
   unitName: string;
   prefix: UnitPrefix;
   defaultDecPlaces: number;
   maxInPrefixedUnits: number;
   maxInADCValues: number;
   minInPrefixedUnits: number;
   minInADCValues: number;
   maxValidADCValue: number; //gray limit lines and "out of range" displayed above this value
   minValidADCValue: number; //gray limit lines and "out of range" displayed below this value
   //allowAutoPrefix: boolean;
}

export enum UnitPrefix {
   kUndefinedPrefix = 0 | 0,
   kNoPrefix = kUndefinedPrefix + 1,
   kAtto = kNoPrefix + 1,
   kFemto = kAtto + 1,
   kPico = kFemto + 1,
   kNano = kPico + 1,
   kMicro = kNano + 1,
   kMilli = kMicro + 1,
   kUnity = kMilli + 1,
   kKilo = kUnity + 1,
   kMega = kKilo + 1,
   kGiga = kMega + 1,
   kTera = kGiga + 1,
   kP = kTera + 1,
   kE = kP + 1,
   kNumUnitPrefixes = kE + 1
}

//Events fired from JS Open Proxy Devices onDeviceEvent() method.

//see /libs/quark-sys\libs/QuarkCOMInterfaces/IOpenDeviceConnection.h
export enum DeviceEvent {
   kDeviceNoEvent = 0 | 0,
   kDeviceStarted = 1 | 0,
   kDeviceStopped = 2 | 0,
   kDeviceDataLoss = 3 | 0,
   kDeviceStartSamplingWarning = 4 | 0,
   kDeviceStartSamplingUserQuery = 5 | 0,
   kDeviceManagerError = 6 | 0,
   kDeviceEvent = 7 | 0 //e.g. adding annotations without displaying popup
}

//see /libs/quark-sys\libs/QuarkCOMInterfaces/IOpenDeviceConnection.h
export enum TMessageSeverity {
   kMessageNoSeverity = 0 | 0, //Let the TS code choose, e.g. a suspender implies a warning by default
   kMessageInfo = 1 | 0,
   kMessageWarn = 2 | 0,
   kMessageError = 3 | 0
}

//Future use
//see /libs/quark-sys\libs/QuarkCOMInterfaces/IOpenDeviceConnection.h
export enum TMessageFlags {
   kMessageFlagsNil = 0 | 0,
   kMessageAddAnotation = 0x80000000 | 0,
   kMessageError = 0x40000000 | 0,
   kMessageQueryStop = 0x20000000 | 0
}

export enum MetaDataColors {
   kLimeGreen,
   kGreen,
   kBlueGreen,
   kBlue,
   kLightBlue,
   kColorInfo = kLightBlue,
   kPurple,
   kYellow,
   kRed,
   kColorError = kRed,
   kOrange,
   kColorWarning = kOrange,
   kGray,
   kMagenta,
   kBrown
}

export interface AnnotationMetadataSys {
   tags: { name: string; type: string }[];
   colorIndex: MetaDataColors;
   subject?: string; // Optional, means 'ALL' is against 'subject' not dataset
}

//See setOptionsOnDeviceEventInfo in quark-sys\libs\device-manager\OpenProxyDevice.cpp
export interface ISysEventOptions {
   onceOnly?: string;
   severity?: TMessageSeverity;
   flags?: TMessageFlags;
   streamIndex?: number;
   metadata?: AnnotationMetadataSys;
}

export interface IWritable {
   _write(
      chunk: any,
      encoding: BufferEncoding,
      callback: (error?: Error | null) => void
   ): void;
   setDefaultEncoding(encoding: string): this;
   destroy(error?: Error): void;
}

export interface IDuplexStream extends IWritable {
   source: DuplexDeviceConnection;
   isRunning: boolean;
   lastErr: Error | null;
   timeoutms: number;
   timer?: NodeJS.Timeout;

   setReadTimeout(ms: number): void;
   //   _read(size: number): void;
   on: (event: string | symbol, listener: (...args: any[]) => void) => void;

   write(
      chunk: any,
      encoding?: BufferEncoding,
      cb?: (error: Error | null | undefined) => void
   ): boolean;
}

export enum SysStreamEventType {
   kApplyStreamSettingsToHardware = 0 | 0
}

export interface IDeviceProxyAPI {
   /**
    * Invokes an arbitrary function on the JS ProxyDevice on the devices thread. 
    * This is a general mechanism whereby user actions done
    * on the main (UI) thread can be applied down to the device script.
    *
    * @param functionName Name of the function to call
    * @param functionArgJson e.g. { type: "HCU" }
    * @param callback is invoked once the function call completes.
    */

   /**
    * Invokes an arbitrary function on the JS ProxyDevice on the devices thread. 
    * This is a general mechanism whereby user actions done
    * on the main (UI) thread can be applied down to the device script.
    *
    * @param functionName Name of the function to call
    * @param functionArgJson e.g. { type: "HCU" }
    *
    * @returns a javascript object the function may have returned, otherwise null.
    */
   callFunction(
      functionName: string,
      functionArgJson: string,
      checkExistsOnly?: boolean
   ): Promise<Record<string, any> | null>;

}



export interface IDeviceManagerApi {
   dispose(): void;

   isSampling: boolean;
   setSampling(sampling: boolean): Promise<boolean>;

   /**
    * Whether multi-rate sampling is enabled.
    */
   multiRate: boolean;

   /**
    * @returns the display name of a device being used in a recording.
    *
    * @param deviceIndex The index of the device.
    */
   deviceDisplayName(deviceId: DeviceProxyId): string | undefined;

   /**
    * @returns the internal/model name of a device being used in a recording.
    *
    * @param deviceIndex The index of the device.
    */
   deviceInternalName(deviceId: DeviceProxyId): string | undefined;

   /**
    * PowerLab only.
    *
    * Returns a string describing the current status of a POD or Front-end
    * setting or control.
    *
    * @param statusType
    */
   getStreamStatus(
      deviceIndexUnused: number,
      streamIndex: number,
      statusType: DeviceInputStatusTypes
   ): string | undefined;

   /**
    * PowerLab only.
    *
    * Not all pods or front-ends support actions. May fail silently.
    *
    * Async because some actions (such as zeroing) may be long running.
    *
    * @param actionType The type of action to perform.
    *
    * @param actionValue Any associated value for the action, otherwise empty string.
    *
    * @param onDoneCallback Called when action completes (on main thread).
    * If sampling was suspended, sampling will now have resumed again by the time
    * this is called.
    *
    * @param onDidSetOptionCallback Called when action completes (on main thread).
    * Optional. If sampling was suspended, this callback provides an opportunity
    * for UI to retrieve the new status (post action being performed) before
    * sampling resumes.
    */
   performStreamAction(
      deviceIndex: number,
      streamIndex: number,
      actionType: DeviceInputActionTypes,
      actionValue: string,
      onDoneCallback: (error: Error | null, result: boolean) => void,
      onDidSetOptionCallback?: (error: Error | null, result: boolean) => void
   ): void;

   /**
    * Deprecated! Use the simpler and more general IDeviceProxyAPI.callFunction() instead! 
    * Invokes an arbitrary function somewhere within the device manager settings
    * on the devices thread. This is the general mechanism whereby user actions done
    * on the main (UI) thread are applied down to the device hardware.
    *
    * @param pathToObject path from the root devman settings to the function being
    * called, not including the function name itself. E.g. .dataInStreams[0]
    * @param functionName Name of the function to call
    * @param functionArgJson e.g. { type: "HCU" }
    *
    * @returns a javascript object the function may have returned, otherwise null.
    */
   callFunction(
      pathToObject: string,
      functionName: string,
      functionArgJson: string
   ): Promise<Record<string, any> | null>;

   settingsPath(
      entity:
         | { type: 'device'; deviceId: DeviceProxyId }
         | { type: 'stream'; deviceId: DeviceProxyId; streamIndex: number }
   ): string;

   proxyFromId(deviceId: DeviceProxyId): IDeviceProxyAPI;
}

export interface IDataSink {
   outStreamBuffers: IStreamBuffer[];

   onSamplingStarted(): void;
   onSamplingUpdate(): void;
   onSamplingStopped(errorMsg: string): void;
   onRemoteTimeEvent?(
      error: Error | null,
      timePoint: TimePoint | FirstSampleRemoteTime | USBTimePoint | null
   ): void;
   onPacket?(packetType: unknown, buffer: unknown): void;
   onError(err: Error): void;
   inputToStream?: number[];  //mapping from device inputs to device output streams
}

//The JS part of the ProxyDevice called from Quark
export interface IProxyDevice {
   //These properties accessed by Quark
   isSampling: boolean;
   outStreamBuffers: StreamRingBuffer[];

   getOutBufferInputIndices(): Int32Array;

   getDeviceName(): string;
   getNumberOfAnalogStreams(): number;
   getLastError(): string;

   setPhysicalDevice(physicalDevice: OpenPhysicalDevice): boolean;

   //called from Quark to allow this proxy to communicate with the device
   connectToPhysicalDevice(): boolean;

   //called from Quark to stop this proxy communicating with the device to
   //allow another proxy to use the device.
   disconnectFromPhysicalDevice(): void;

   //Allocate StreamRingBuffers buffers
   prepareForSampling(bufferSizeInSecs: number): boolean;

   startSampling(): boolean;

   onSamplingStarted(): void;
   onSamplingUpdate(): void;
   onSamplingStopped(errorMsg: string): void;

   stopSampling(): boolean;

   //Release buffers
   cleanupAfterSampling(): boolean;

   //Option support for compensating for a known fixed delay between asking the device
   //to start sampling and the time when the first sample is actually measured
   //by the ADC on the device.
   getStartDelayMicroSeconds?(): number;

   //Option support for providing a more accurate estimate of the time (using the local PC's steady clock)
   //at which the device actually started sampling
   getLocalClockTickAtSamplingStart?(): TInt64 | undefined;
}

export enum TestDeviceFakeConnectionIndices {
   kTestDevice0 = 0 | 0,
   kTestDevice1 = 1 | 0,
   kTestDevice2 = 2 | 0,
   kNIBP0 = 3 | 0,
   kKent0 = 4 | 0
}

export function allFakeTestDeviceNames(): string[] {
   return [
      'Test OpenBCI-8s',
      'Test OpenBCI-2s',
      'Test OpenBCI-6s',
      'Test NIBP',
      'Test Kent'
   ];
}
