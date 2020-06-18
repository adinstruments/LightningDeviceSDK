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

//See boost ASIO: /boost/asio/serial_port_base.hpp
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
}

export interface DuplexDeviceConnection extends DeviceConnection {
   //callBack returns with error === null if write succeeded
   //setWriteHandler( callBack:(error: Error | null) => void): void;
   write(buffer: Buffer, callback: (error?: Error) => void): void;
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
   ringBufferBuffer: Buffer; //Memory under ringBuffer (shared with Quark)
   inIndex: number; //read by Quark to see if data is available
   outIndex: number; //written by Quark when data is read from buffer.
}

// Allows it to be inherited from.
export type HierarchyOfDeviceSettingsBase = HierarchyOfDeviceSettings | any;

export interface IDeviceProxySettingsSys extends HierarchyOfDeviceSettingsBase {
   version: number;
   dataInStreams: IDeviceStreamSettingsSys[];
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

   /**
    * Updates the JS setting to match the actual device's setting. This allows
    * the UI to reflect the state of settings that were coerced in response to
    * some other setting change. E.g. Bio Amp low/hi pass filter settings.
    */
   update?(): void;

   /**
    * Similar to update() except a setting's options are reloaded.
    */
   reloadOptions?(): void;
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
   deviceType: string;
   numInputs: number;

   // A unique identifier for this piece of hardware.
   deviceId: string;
}

export interface OpenPhysicalDevice {
   deviceConnection: DuplexDeviceConnection;
   getDeviceName(): string;
   getNumberOfAnalogInputs(): number;
   getNumberOfAnalogStreams(): number;
   getDescriptor(): OpenPhysicalDeviceDescriptor;
   release?(): void;
}

export interface IDeviceStreamSettingsSys
   extends HierarchyOfDeviceSettingsBase {
   inputSettings: IDeviceInputSettingsSys;
   enabled: IDeviceSetting;
   samplesPerSec: IDeviceSetting;

   streamName?: string;
   // The following are currently supplied by PowerLabs.
   userEnabled?: boolean;
   streamInDevice?: number;
}

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
   kDevConTypeMockSerialPortsForTesting = kDeviceConnectionTypeBase + 2
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
      settings: IDeviceStreamSettingsSys,
      configuration: Partial<IDeviceStreamConfiguration>,
      callback?: (error: Error | null, type: SysStreamEventType) => void,
      restartAnySampling?: boolean
   ): void;

   //onSamplingStarted(): void;

   //Call into Quark (OpenDeviceProxy) at about 20 Hz max to indicate new data is available
   samplingUpdate(bufferInputIndices: Int32Array): void;

   //Consider passing an error code as well so Quark can more easily determine what to
   //do if there is an error.
   //onSamplingStopped(errorMsg: string /*, errorCode: SamplingError*/): void;

   onDeviceEvent(event: DeviceEvent, message?: string): void;
}

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

//Events fired from JS Open Proxy Devices onDeviceEvent() method, see
// /libs/quark-sys\libs/QuarkCOMInterfaces/IOpenDeviceConnection.h
export enum DeviceEvent {
   kDeviceNoEvent = 0 | 0,
   kDeviceStarted = 1 | 0,
   kDeviceStopped = 2 | 0,
   kDeviceDataLoss = 3 | 0
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
