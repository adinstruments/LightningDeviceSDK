import { IDataSink, IDuplexStream } from '../../../public/device-api';
import {
   PacketType,
   CuffMode,
   CuffSwitchInterval,
   PhysiocalState,
   kWarningAnnotationTimeoutms,
   kDefaultCuffSwitchingInterval,
   kSupportedSamplesPerSec,
   kPressureRangeMaxMmHg,
   NanoChannels,
   NanoHCUState,
   NanoModes,
   NanoRxSampCmds,
   NanoTxSampCmds,
   kConversionFactor,
   kCmdBytePacketOffset,
   kDataSamplesPerStatusSample,
   kPhysiocalOffBeats,
   kBeatIntegerScalingFactor,
   kCalIntegerScalingFactor,
   kCuffCountdownIntegerScalingFactor,
   kActiveCuffIntegerScalingFactor,
   kBaseVersionInfo,
   VersionPacketType,
   PacketLength,
   kCuffIsSwitching
} from './constants';
import { ProxyDevice } from './proxy';
import { INIBPSettings } from './settings';
import { CheckCRC, findVersionInfoData } from './utils';
import {
   NIBPErrors,
   nanoWarningsArray,
   kHandleWarningFlag,
   WarningFlags,
   getErrorCode,
   NIBPErrorCodes
} from './errorMessages';
import { debugLog, kLogAllWarnings } from './enableLogging';

enum SamplingState {
   kIdle,
   kSampling
}

// Don't fire notifications into Lightning too often
const kMinimumSamplingUpdatePeriodms = 50;
const kMinimumKeepAlivePeriodms = 500;
const kWatchDogPeriodms = 1000;

const kDisplayNanoWarnings = false;

/**
 * An object that handles parsing of data returned from the example device.
 * Note that this is device-specific and will need to be changed for any other device.
 */
export class NanoParser {
   samplingState: SamplingState;
   lastError = '';
   proxyDevice: IDataSink | ProxyDevice | null = null;
   inStream: IDuplexStream;
   deviceName: string;
   mBuffer: Buffer | null;
   dataSampleSampleCount: number;
   beat2BPadSampleCount: number;
   statusPadSampleCount: number;

   lastB2bTimeStamp: number;

   _lastSYSdata: number;
   _lastMAPdata: number;
   _lastDIAdata: number;

   _lastHRdataBper10min: number;
   _lastIBIdata: number;
   _lastActiveCuff: number;
   _lastCuffCountdownSecs: number;
   _lastAutoCalCountdowndata: number;

   lastCuffCountdownMins: number;
   cuffStartTimeStamp: number;

   beat2BPacketCount: number;

   dataPadTimerms: number;

   lastHCUStatusdata: number;
   lastStatusError: number;
   lastStatusWarning: number;
   haveWarnedHCUNotZeroed: boolean;

   criticalError: boolean;
   raisedErrors: number[];
   raisedWarnings: number[];
   raisedWarningTimestamps: number[];

   lastStatusMode: NanoModes;
   lastPhysiocalState: PhysiocalState;
   enablePhysioCal: boolean;

   HGTValuesBetweenBeat: number[];
   _lastHeightAverage: number;

   cuffSwitchingInterval: CuffSwitchInterval;
   continueOnError: boolean;

   lastUpdateTimems: number;
   lastKeepAliveTimems: number;

   expectedDataTransmissionTimeStamp: number;
   expectedStatusTimeStamp: number;

   watchDogTimeout: NodeJS.Timeout;

   get lastHeightAverageScaled() {
      return this._lastHeightAverage * kBeatIntegerScalingFactor;
   }

   // Scaled data accessors
   get lastSysDataScaled() {
      return this._lastSYSdata * kBeatIntegerScalingFactor;
   }
   get lastMAPDataScaled() {
      return this._lastMAPdata * kBeatIntegerScalingFactor;
   }
   get lastDiaDataScaled() {
      return this._lastDIAdata * kBeatIntegerScalingFactor;
   }

   get lastHRDataBper10minScaled() {
      return this._lastHRdataBper10min * kBeatIntegerScalingFactor;
   }

   get lastIBIDataScaled() {
      return this._lastIBIdata * kBeatIntegerScalingFactor;
   }

   get lastActiveCuffScaled() {
      return this._lastActiveCuff * kActiveCuffIntegerScalingFactor;
   }
   get lastCuffCountdownSecsScaled() {
      return this._lastCuffCountdownSecs * kCuffCountdownIntegerScalingFactor;
   }
   get lastAutoCalCountdownDataScaled() {
      return this._lastAutoCalCountdowndata * kCalIntegerScalingFactor;
   }

   // Height corrected scaled data accessors
   get hcLastSysDataScaled() {
      return this.lastSysDataScaled + this.lastHeightAverageScaled;
   }
   get hcLastMAPDataScaled() {
      return this.lastMAPDataScaled + this.lastHeightAverageScaled;
   }
   get hcLastDiaDataScaled() {
      return this.lastDiaDataScaled + this.lastHeightAverageScaled;
   }

   constructor(
      inStream: IDuplexStream,
      //Add IDataSink type to proxy device.
      //For some commands exists only on ProxyDevice,
      //so the type should be checked before
      proxyDevice: IDataSink | ProxyDevice | null,
      deviceName: string
   ) {
      this.samplingState = SamplingState.kIdle;
      this.proxyDevice = proxyDevice;
      this.inStream = inStream;
      this.deviceName = deviceName;

      this.onError = this.onError.bind(this);
      this.onData = this.onData.bind(this);

      this.mBuffer = null;
      this.dataSampleSampleCount = 0;
      this.beat2BPadSampleCount = 0;
      this.statusPadSampleCount = 0;

      this.lastB2bTimeStamp = 0;

      this._lastSYSdata = 0;
      this._lastMAPdata = 0;
      this._lastDIAdata = 0;

      this._lastHRdataBper10min = 0;
      this._lastIBIdata = 0;

      this._lastActiveCuff = 1;
      this._lastCuffCountdownSecs = 0;
      this._lastAutoCalCountdowndata = 0;
      this.lastHCUStatusdata = -1;
      this.lastCuffCountdownMins = -1;

      this.beat2BPacketCount = 0;

      this.dataPadTimerms = 0;

      this.lastStatusError = 0;
      this.lastStatusWarning = 0;
      this.haveWarnedHCUNotZeroed = false;

      this.criticalError = false;
      this.raisedErrors = [];
      this.raisedWarnings = [];
      this.raisedWarningTimestamps = [];

      this.lastStatusMode = 0;
      this.lastPhysiocalState = PhysiocalState.kPhysiocalOnIdle;

      this.HGTValuesBetweenBeat = [];
      this._lastHeightAverage = 0;

      this.cuffSwitchingInterval = kDefaultCuffSwitchingInterval;

      this.continueOnError = false;

      this.inStream.setDefaultEncoding('binary');
      this.inStream.on('error', this.onError);
      this.inStream.on('data', this.onData);
   }

   /**
    *
    * Write to the outstream buffers to get data into Lightning
    *
    * @param channel
    * @param data
    */
   writeOutStream(channel: NanoChannels, data: number) {
      this.proxyDevice?.outStreamBuffers[channel]?.writeValue?.(data);
   }

   /**
    * Settings API
    */
   setAutocalibrationEnabled(enabled: boolean) {
      // have to remember this, see onData
      this.enablePhysioCal = enabled;

      if (!!this.lastPhysiocalState == enabled)
         // > kPhysiocalOff = 0x00
         return;

      this.inStream.write(
         enabled
            ? NanoTxSampCmds.kEnablePhysioCal
            : NanoTxSampCmds.kDisablePhysioCal
      );
   }

   setCuffMode(mode: CuffMode) {
      switch (mode) {
         case CuffMode.UseCuff1:
            this.inStream.write(NanoTxSampCmds.switchIntervalCommand(0)); // disable
            this.inStream.write(NanoTxSampCmds.kUseCuffOne);
            this.inStream.write(NanoTxSampCmds.resetCuffScheduler());
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
      this.inStream.write(
         NanoTxSampCmds.switchIntervalCommand(this.cuffSwitchingInterval)
      );
      this.inStream.write(NanoTxSampCmds.resetCuffScheduler());
      this.inStream.write(NanoTxSampCmds.resetCuffScheduler());
   }

   setContinueOnError(enabled: boolean) {
      this.continueOnError = enabled;
   }

   isSampling() {
      return this.samplingState == SamplingState.kSampling;
   }

   onError(err: Error) {
      this.lastError = err.message;

      if (
         this.proxyDevice instanceof ProxyDevice &&
         this.lastError.includes('IO Exception')
      ) {
         this.proxyDevice.displayError(
            'Unexpected IO error, please check device is plugged in correctly.',
            !this.continueOnError,
            'Unexpected IO Error'
         );
      }
      console.error(err);
   }

   setProxyDevice(proxyDevice: IDataSink | ProxyDevice | null) {
      this.proxyDevice = proxyDevice;
   }

   exitCurrentMode() {
      switch (this.lastStatusMode) {
         case NanoModes.Measure:
            this.inStream.write(NanoTxSampCmds.kStopMeasure);
            break;

         case NanoModes.Service:
            this.inStream.write(NanoTxSampCmds.kExitTestMode);
            break;

         case NanoModes.Error:
            this.inStream.write(NanoTxSampCmds.kClearFirstError);
            break;

         default:
            break;
      }
   }

   startSampling(settings: INIBPSettings) {
      if (!this.inStream || !this.proxyDevice) return false;

      settings.sendToHardware();

      this.expectedDataTransmissionTimeStamp = 0;
      this.expectedStatusTimeStamp = 0;

      // Ignore any bytes stored from the previous sampling session.
      this.mBuffer = null;
      this.dataSampleSampleCount = 0;
      this.beat2BPadSampleCount = 0;
      this.statusPadSampleCount = 0;

      // used for physiocal setting
      this.beat2BPacketCount = 0;

      // used for continueOnError
      this.dataPadTimerms = 0;

      this.lastB2bTimeStamp = 0;

      this._lastSYSdata = 0;
      this._lastMAPdata = 0;
      this._lastDIAdata = 0;
      this._lastHRdataBper10min = 0;
      this._lastIBIdata = 0;
      this._lastCuffCountdownSecs = 0;
      this._lastAutoCalCountdowndata = 0;
      this.cuffStartTimeStamp = 0;
      this.lastCuffCountdownMins = -1;

      this._lastActiveCuff = 1; // always start on Cuff 1

      this.criticalError = false;
      this.raisedErrors = [];
      this.raisedWarnings = [];
      this.raisedWarningTimestamps = [];
      this.haveWarnedHCUNotZeroed = false;

      this.inStream.write(NanoTxSampCmds.kStartMeasure);
      this.samplingState = SamplingState.kSampling;
      this.proxyDevice.onSamplingStarted();
      this.lastUpdateTimems = performance.now();
      this.lastKeepAliveTimems = performance.now();

      this.checkWatchDog();

      return true;
   }

   // A watch dog is needed for the case when someone unplugs
   // the wrist unit from the interface
   checkWatchDog() {
      clearTimeout(this.watchDogTimeout);

      if (this.isSampling()) {
         const nowMs = performance.now();
         if (nowMs - this.lastUpdateTimems > kWatchDogPeriodms) {
            if (this.proxyDevice instanceof ProxyDevice) {
               this.proxyDevice.displayError(
                  'LabChart Lightning has lost communication with the wrist unit. Please check it is connected',
                  !this.continueOnError,
                  'hNIBPWatchDog'
               );
            }
         } else {
            this.watchDogTimeout = setTimeout(() => {
               this.checkWatchDog();
            }, kWatchDogPeriodms);
         }
      }
   }

   stopSampling(err = '', contOnErr = false) {
      this.exitCurrentMode();
      clearTimeout(this.watchDogTimeout);

      if (contOnErr) {
         // zerofy the padded data
         this._lastSYSdata = 0;
         this._lastMAPdata = 0;
         this._lastDIAdata = 0;
         this._lastHRdataBper10min = 0;
         this._lastIBIdata = 0;
         this._lastActiveCuff = 0;
         this.lastCuffCountdownMins = -1;
         this._lastCuffCountdownSecs = 0;
         this._lastAutoCalCountdowndata = 0;
         return false;
      }

      // TODO: this doesn't work currently, we ideally want to pad out
      // the rest of the channel as LC8 does. the B2b data comes aperiodically
      // LC8 does this by: sampling for another second after the user clicks 'Stop'
      //  and then truncating the end of the data shown in the chart view
      // this.padBeatToBeatDataTransmissionPacketData();
      // if (this.proxyDevice) this.proxyDevice.onSamplingUpdate();

      this.samplingState = SamplingState.kIdle;

      if (!this.inStream) return false;

      if (this.proxyDevice) this.proxyDevice.onSamplingStopped(err);

      return true;
   }

   onData = (inBuffer: Buffer) => {
      if (!inBuffer.length) return;

      if (this.mBuffer != null) {
         const bytes = [this.mBuffer, inBuffer];
         this.mBuffer = Buffer.concat(
            bytes,
            this.mBuffer.length + inBuffer.length
         );
      } else this.mBuffer = inBuffer;

      let nextPacketStart = 0;

      for (let itr = 0; itr < this.mBuffer.length; ++itr) {
         const byte = this.mBuffer[itr];

         // TODO: cut up the packet...
         if (!this.confirmPacket(this.mBuffer, byte, itr)) continue;

         switch (byte) {
            case PacketType.DataTransmission: // if isSampling()
               nextPacketStart = this.processDataTransmissionPacket(
                  this.mBuffer,
                  itr
               );
               break;

            case PacketType.Beat2BDataTransmission: // if isSampling()
               nextPacketStart = this.processBeatToBeatDataTransmissionPacket(
                  this.mBuffer,
                  itr
               );
               break;

            case PacketType.Status:
               nextPacketStart = this.processStatusPacket(this.mBuffer, itr);
               break;

            case PacketType.VersionInfo:
               nextPacketStart = this.processVersionData(this.mBuffer, itr);
               break;

            default:
               break;
         }

         // skip the bytes in the packet that's already been processed
         if (nextPacketStart > itr) itr = nextPacketStart - 1;
      }

      if (nextPacketStart <= this.mBuffer.length) {
         // will always be
         this.mBuffer = this.mBuffer.slice(
            nextPacketStart,
            this.mBuffer.length
         );
      } else {
         this.mBuffer = null;
      }

      if (!this.isSampling()) return;

      if (this.criticalError && this.continueOnError) {
         this.padDataTransmissionPacketData();
         this.padBeatToBeatDataTransmissionPacketData();
      }

      this.padLowRateStatusData();

      // workaround for nano issue - disabling the physiocal only works
      // during sampling so if the user has it set before sampling,
      // we wait for some b2b packets before setting it off again
      if (
         !this.enablePhysioCal &&
         this.lastPhysiocalState !== PhysiocalState.kPhysiocalOff &&
         this.beat2BPacketCount >= kPhysiocalOffBeats
      ) {
         this.setAutocalibrationEnabled(false);
      }

      const nowMilliseconds = performance.now();

      if (
         nowMilliseconds - this.lastUpdateTimems >
         kMinimumSamplingUpdatePeriodms
      ) {
         if (this.proxyDevice) this.proxyDevice.onSamplingUpdate();

         this.lastUpdateTimems = nowMilliseconds;
      }

      if (
         nowMilliseconds - this.lastKeepAliveTimems >
         kMinimumKeepAlivePeriodms
      ) {
         if (!this.criticalError) this.inStream.write(NanoTxSampCmds.kAlive);

         this.lastKeepAliveTimems = nowMilliseconds;
      }
   }; //onData

   padDataTransmissionPacketData() {
      if (!this.proxyDevice) {
         debugLog('Tried to process data transmission but had no proxy device');
         return; // Something has gone terribly wrong
      }

      const totalExpectedSamples =
         ((performance.now() - this.dataPadTimerms) *
            kSupportedSamplesPerSec[0]) /
         1000;

      while (this.dataSampleSampleCount < totalExpectedSamples - 1) {
         this.writeOutStream(NanoChannels.kBP, 0);
         this.writeOutStream(NanoChannels.kBPHC, 0);
         this.writeOutStream(NanoChannels.kHGT, 0);
         this.writeOutStream(NanoChannels.kQualLevel, 0);

         ++this.dataSampleSampleCount;
         ++this.statusPadSampleCount;
         ++this.beat2BPadSampleCount;
      }
   }

   /**
    * Check and confirm the start of the packet message
    * @param buffer
    * @param packetType
    * @param cmdpos
    * @returns
    */
   confirmPacket(buffer: Buffer, packetType: PacketType, cmdpos: number) {
      if (
         cmdpos < kCmdBytePacketOffset ||
         cmdpos + PacketLength[packetType] > buffer.length
      )
         return false;

      let sampCmd: Uint8Array;

      switch (packetType) {
         case PacketType.Beat2BDataTransmission:
            sampCmd = NanoRxSampCmds.kBeat2bCmdHead;
            break;

         case PacketType.DataTransmission:
            sampCmd = NanoRxSampCmds.kDataCmdHead;
            break;

         case PacketType.Status:
            sampCmd = NanoRxSampCmds.kStatusCmdHead;
            break;

         case PacketType.VersionInfo:
            sampCmd = kBaseVersionInfo;
            break;

         default:
            return false;
      }

      for (let i = 0; i < sampCmd.length; ++i) {
         // iterate over the previous bytes to make sure it matches expected answer
         if (sampCmd[i] !== buffer[cmdpos - kCmdBytePacketOffset + i])
            return false;
      }

      return true;
   }

   /**
    * CRC-check in order to detect transmission failures
    * @param byteArray
    * @param cmdpos
    * @param offset
    */
   runCheckCRC(byteArray: Buffer, cmdpos: number, crcOffset: number) {
      const dataPacket = byteArray.slice(cmdpos, cmdpos + crcOffset);

      const crc = byteArray[cmdpos + crcOffset];

      if (!CheckCRC(dataPacket, crc))
         // TODO: do something?
         console.warn('CRC did not match Caculated CRC for: ' + dataPacket);
   }

   /**
    * Process DataTransmission data - Finger blood pressure, Height correction, Physiocal state - Quality
    * @param byteArray
    * @param dcmdPos
    * @returns
    */
   processDataTransmissionPacket(byteArray: Buffer, dcmdPos: number) {
      if (!this.proxyDevice || !this.isSampling() || this.criticalError)
         // move buffer ptr along but don't process it
         return (
            dcmdPos +
            PacketLength[PacketType.Beat2BDataTransmission] -
            kCmdBytePacketOffset
         );

      this.runCheckCRC(byteArray, dcmdPos, NanoRxSampCmds.kDataCmdHead[1]);

      let currentTimeStamp = byteArray.readUInt16LE(dcmdPos + 1);

      if (!this.lastB2bTimeStamp && !this.beat2BPacketCount)
         this.lastB2bTimeStamp = currentTimeStamp;

      if (
         this.expectedDataTransmissionTimeStamp &&
         currentTimeStamp != this.expectedDataTransmissionTimeStamp
      ) {
         debugLog('Data currentTimeStamp: ' + currentTimeStamp);
         debugLog(
            'Data expectedTimeStamp: ' + this.expectedDataTransmissionTimeStamp
         );

         if (currentTimeStamp >= 2 ** 16) currentTimeStamp = -1;

         this.expectedDataTransmissionTimeStamp = currentTimeStamp + 1;
      }

      // signed 16bit values, 1/10 mmHg
      let BPdataDecimmHg = byteArray.readInt16LE(dcmdPos + 3);
      const HGTdataDecimmHg = byteArray.readInt16LE(dcmdPos + 5);
      const qualityLevel = byteArray[dcmdPos + 9] & 0x0f;

      // zerofies crufty pre-sampling nano-spew data at start of record
      if (BPdataDecimmHg > kPressureRangeMaxMmHg * kConversionFactor)
         BPdataDecimmHg = 0x00;

      this.HGTValuesBetweenBeat.push(HGTdataDecimmHg);

      this.writeOutStream(NanoChannels.kBP, BPdataDecimmHg);
      this.writeOutStream(NanoChannels.kBPHC, BPdataDecimmHg + HGTdataDecimmHg);

      // These values are scaled for autoscale
      this.writeOutStream(
         NanoChannels.kHGT,
         HGTdataDecimmHg * kBeatIntegerScalingFactor
      );
      this.writeOutStream(
         NanoChannels.kQualLevel,
         qualityLevel * kCalIntegerScalingFactor
      );

      ++this.beat2BPadSampleCount;
      ++this.statusPadSampleCount;
      ++this.dataSampleSampleCount;

      if (!this.dataPadTimerms) {
         // startTickms effectively
         this.dataPadTimerms = performance.now();
      }

      return (
         dcmdPos +
         PacketLength[PacketType.DataTransmission] -
         kCmdBytePacketOffset
      );
   }

   /**
    * Process BeatToBeatDataTransmissionPacket data - Finger pressure data
    * @param byteArray
    * @param bcmdPos
    * @returns
    */
   processBeatToBeatDataTransmissionPacket(byteArray: Buffer, bcmdPos: number) {
      if (!this.proxyDevice || !this.isSampling() || this.criticalError)
         // move buffer ptr along but don't process it
         return (
            bcmdPos +
            PacketLength[PacketType.Beat2BDataTransmission] -
            kCmdBytePacketOffset
         );

      ++this.beat2BPacketCount; // used for physioCal setting

      // no sample count check as these packets arrive aperiodically
      this.runCheckCRC(byteArray, bcmdPos, NanoRxSampCmds.kBeat2bCmdHead[1]);

      const B2bTimestamp = byteArray.readUInt16LE(bcmdPos + 1);

      if (B2bTimestamp < this.lastB2bTimeStamp) this.lastB2bTimeStamp -= 65536; // account for wrapping (2^16)

      // retroactively fill in beat2Beat data with latest data
      while (this.lastB2bTimeStamp < B2bTimestamp) {
         this.writeOutStream(NanoChannels.kSYS, this.lastSysDataScaled);
         this.writeOutStream(NanoChannels.kSYSHC, this.hcLastSysDataScaled);
         this.writeOutStream(NanoChannels.kMAP, this.lastMAPDataScaled);
         this.writeOutStream(NanoChannels.kMAPHC, this.hcLastMAPDataScaled);
         this.writeOutStream(NanoChannels.kDIA, this.lastDiaDataScaled);
         this.writeOutStream(NanoChannels.kDIAHC, this.hcLastDiaDataScaled);
         this.writeOutStream(NanoChannels.kHR, this.lastHRDataBper10minScaled);
         this.writeOutStream(NanoChannels.kIBI, this.lastIBIDataScaled);

         ++this.lastB2bTimeStamp;
         --this.beat2BPadSampleCount; // used for continueOnError
      }

      // we pad out the data with the last values so that it aligns with the
      // pressure data better, else it's 1 beat out of sync
      // beat_to_beat packets with Sys, Map, Dia, HR and IBI data
      this._lastSYSdata = byteArray.readUInt16LE(bcmdPos + 4);
      this._lastDIAdata = byteArray.readUInt16LE(bcmdPos + 6);
      this._lastMAPdata = byteArray.readUInt16LE(bcmdPos + 8);
      this._lastHRdataBper10min = byteArray.readUInt16LE(bcmdPos + 10);
      this._lastIBIdata = byteArray.readUInt16LE(bcmdPos + 12);

      // apply height correction
      this._lastHeightAverage = this.calcHeightAverage();
      this.HGTValuesBetweenBeat = [];

      return (
         bcmdPos +
         PacketLength[PacketType.Beat2BDataTransmission] -
         kCmdBytePacketOffset
      );
   }

   /**
    * Process status packets with ActiveCuff, CuffCountdown and AutoCalCountdown data
    * @param byteArray
    * @param scmdPos
    * @returns
    */
   processStatusPacket(byteArray: Buffer, scmdPos: number) {
      if (!this.proxyDevice) return 0;

      this.runCheckCRC(byteArray, scmdPos, NanoRxSampCmds.kStatusCmdHead[1]);

      this.handleStatusFlags(byteArray, scmdPos);

      if (!this.isSampling() || this.criticalError)
         return (
            scmdPos + PacketLength[PacketType.Status] - kCmdBytePacketOffset
         );

      let currentTimeStamp = byteArray.readUInt16LE(scmdPos + 1);

      if (
         this.expectedStatusTimeStamp &&
         currentTimeStamp != this.expectedStatusTimeStamp
      ) {
         debugLog('status currentTimeStamp: ' + currentTimeStamp);
         debugLog('status expectedTimeStamp: ' + this.expectedStatusTimeStamp);

         if (currentTimeStamp >= 2 ** 16) {
            debugLog('This seesm impossible given a uint16');
            currentTimeStamp = -kDataSamplesPerStatusSample;
         }
         this.expectedStatusTimeStamp =
            currentTimeStamp + kDataSamplesPerStatusSample;
      }

      const activeCuff = byteArray[scmdPos + 10] & 0x03;

      if (!!activeCuff && this._lastActiveCuff != activeCuff) {
         this._lastActiveCuff = activeCuff;

         if (this.proxyDevice instanceof ProxyDevice)
            this.proxyDevice.addAnnotation(
               'Switching to Cuff ' + this._lastActiveCuff
            );
      }

      const cuffCountdownMins = byteArray[scmdPos + 10] >> 2;

      this._lastAutoCalCountdowndata = this.enablePhysioCal
         ? byteArray[scmdPos + 12]
         : 0;

      if (this.lastCuffCountdownMins === -1) {
         this.cuffStartTimeStamp = performance.now() / 1000;
      }

      // Reset cached countdown
      this._lastCuffCountdownSecs = 0;

      // 0x00 = Automatic cuff control is disabled
      // 0x3E = 62 = Switching (or enabling) cuff now
      if (cuffCountdownMins === kCuffIsSwitching) {
         if (this.lastCuffCountdownMins !== kCuffIsSwitching) {
            this.cuffStartTimeStamp = performance.now() / 1000;
            this.lastCuffCountdownMins = cuffCountdownMins;
         }
      } else if (cuffCountdownMins > 0) {
         const nowSec = performance.now() / 1000;

         if (this.lastCuffCountdownMins === kCuffIsSwitching) {
            this.lastCuffCountdownMins = cuffCountdownMins;
         }

         // Whenever the minutes change during a countdown
         // reset the seconds.
         if (this.lastCuffCountdownMins !== cuffCountdownMins) {
            this.lastCuffCountdownMins = cuffCountdownMins;
            this.cuffStartTimeStamp = nowSec;
         }

         this._lastCuffCountdownSecs =
            cuffCountdownMins * 60 - (nowSec - this.cuffStartTimeStamp);
      }

      this.writeOutStream(NanoChannels.kActiveCuff, this.lastActiveCuffScaled);
      this.writeOutStream(
         NanoChannels.kCuffCountdown,
         this.lastCuffCountdownSecsScaled
      );
      this.writeOutStream(
         NanoChannels.kAutoCalCountdown,
         this.lastAutoCalCountdownDataScaled
      );

      --this.statusPadSampleCount;

      return scmdPos + PacketLength[PacketType.Status] - kCmdBytePacketOffset;
   }

   /**
    * Process version packet data
    * @param buffer
    * @returns
    */
   processVersionData(buffer: Buffer, pos: number) {
      let returnPacketType = VersionPacketType.HardwareInfo;
      const dataSink = this.proxyDevice as IDataSink;

      if (dataSink?.onPacket) {
         const byte = buffer[pos + 1];

         // TODO: CRC Check only logs warnings,
         // Probably should do more.
         switch (byte) {
            case VersionPacketType.HardwareInfo:
               this.runCheckCRC(buffer, pos, NanoRxSampCmds.kHardwareInfo[1]);
               returnPacketType = VersionPacketType.HardwareInfo;
               break;
            case VersionPacketType.BootloaderVersion:
               this.runCheckCRC(
                  buffer,
                  pos,
                  NanoRxSampCmds.kBootloaderVersion[1]
               );
               returnPacketType = VersionPacketType.BootloaderVersion;
               break;
            case VersionPacketType.ApplicationVersion:
               this.runCheckCRC(
                  buffer,
                  pos,
                  NanoRxSampCmds.kApplicationVersion[1]
               );
               returnPacketType = VersionPacketType.ApplicationVersion;
               break;

            default:
               debugLog('Not a version packet');
               return (
                  pos +
                  PacketLength[PacketType.VersionInfo] -
                  kCmdBytePacketOffset
               );
         }

         const versionBuffer = findVersionInfoData(
            buffer,
            pos,
            returnPacketType
         );
         if (versionBuffer.length > 0) {
            // Send back to device class to create Physical Device
            dataSink.onPacket(returnPacketType, versionBuffer);
         } else {
            debugLog('Not a version packet');
         }
      }

      return pos + PacketLength[PacketType.VersionInfo] - kCmdBytePacketOffset;
   }

   padBeatToBeatDataTransmissionPacketData() {
      if (!this.proxyDevice || !this.isSampling()) return;

      // this is used only when continue on error is true
      while (this.beat2BPadSampleCount > 0) {
         this.writeOutStream(NanoChannels.kSYS, this.lastSysDataScaled);
         this.writeOutStream(NanoChannels.kSYSHC, this.hcLastSysDataScaled);
         this.writeOutStream(NanoChannels.kMAP, this.lastMAPDataScaled);
         this.writeOutStream(NanoChannels.kMAPHC, this.hcLastMAPDataScaled);
         this.writeOutStream(NanoChannels.kDIA, this.lastDiaDataScaled);
         this.writeOutStream(NanoChannels.kDIAHC, this.hcLastDiaDataScaled);
         this.writeOutStream(NanoChannels.kHR, this.lastHRDataBper10minScaled);
         this.writeOutStream(NanoChannels.kIBI, this.lastIBIDataScaled);

         --this.beat2BPadSampleCount;
      }
   }

   padLowRateStatusData() {
      if (!this.proxyDevice || !this.isSampling()) return;

      // Upsample status data to pressure data
      while (this.statusPadSampleCount > 0) {
         this.writeOutStream(
            NanoChannels.kActiveCuff,
            this.lastActiveCuffScaled
         );
         this.writeOutStream(
            NanoChannels.kCuffCountdown,
            this.lastCuffCountdownSecsScaled
         );
         this.writeOutStream(
            NanoChannels.kAutoCalCountdown,
            this.lastAutoCalCountdownDataScaled
         );

         --this.statusPadSampleCount;
      }
   }

   calcHeightAverage(): number {
      return !this.HGTValuesBetweenBeat.length
         ? 0
         : this.HGTValuesBetweenBeat.reduce((sum, val) => sum + val) /
              this.HGTValuesBetweenBeat.length;
   }

   handleStatusFlags(byteArray: Buffer, scmdPos: number) {
      this.lastStatusWarning = byteArray[scmdPos + 5] & 0xff;
      this.lastStatusWarning |= (byteArray[scmdPos + 6] & 0xff) << 8;
      this.lastStatusWarning |= (byteArray[scmdPos + 7] & 0xff) << 16;
      this.lastStatusWarning |= (byteArray[scmdPos + 8] & 0xff) << 24;

      this.lastStatusError = byteArray[scmdPos + 4] & 0x7f;
      this.lastStatusMode = (byteArray[scmdPos + 3] & 0xf0) >> 4;

      const physioCalState = (byteArray[scmdPos + 11] & 0xc0) >> 6;

      if (physioCalState != this.lastPhysiocalState) {
         if (
            this.isSampling() &&
            this.enablePhysioCal &&
            this.proxyDevice instanceof ProxyDevice
         ) {
            if (
               physioCalState === PhysiocalState.kPhysiocalScan ||
               physioCalState === PhysiocalState.kPhysiocalAdjust
            ) {
               this.proxyDevice.addAnnotation(
                  physioCalState === PhysiocalState.kPhysiocalScan
                     ? 'Physiocal Scanning'
                     : 'Physiocal Adjusting'
               );
            } else if (
               this.lastPhysiocalState === PhysiocalState.kPhysiocalAdjust &&
               physioCalState === PhysiocalState.kPhysiocalOnIdle
            ) {
               this.proxyDevice.addAnnotation('Physiocal Complete');
            }
         }

         this.lastPhysiocalState = physioCalState;
      }

      if (this.lastHCUStatusdata != (byteArray[scmdPos + 9] & 0xe0) >> 5) {
         this.lastHCUStatusdata = (byteArray[scmdPos + 9] & 0xe0) >> 5;
         this.reportHCUStatus();
      }

      if (!this.isSampling()) return;

      // first time around, report if HCU not zeroed - bit hacky..
      if (
         this.lastHCUStatusdata !== NanoHCUState.kHCUZeroed &&
         !this.haveWarnedHCUNotZeroed &&
         this.proxyDevice instanceof ProxyDevice
      ) {
         this.haveWarnedHCUNotZeroed = true;
         this.proxyDevice.displayWarn('HCU not zeroed', 'HCUNOTZEROED', true);
      }

      let errorStr = '';

      if (this.lastStatusError != 0) {
         const lastErrorCode = getErrorCode(this.lastStatusError);
         if (
            this.lastStatusError !==
               NIBPErrorCodes.HcuContr_erro_hcuOffsetToBig &&
            this.lastStatusError !== NIBPErrorCodes.HcuContr_erro_NotAllowed
         ) {
            // HCU zeroing related, not actual errors
            if (this.proxyDevice instanceof ProxyDevice) {
               if (!this.raisedErrors.includes(this.lastStatusError)) {
                  this.proxyDevice.displayError(
                     NIBPErrors[lastErrorCode],
                     !this.continueOnError,
                     NIBPErrorCodes[lastErrorCode]
                  );

                  this.raisedErrors.push(this.lastStatusError);
               }

               console.error(
                  this.deviceName + ' - ' + NIBPErrors[lastErrorCode]
               );
            }

            this.criticalError = true;
         }

         errorStr = NIBPErrors[lastErrorCode];
      }

      if (
         this.lastStatusMode == NanoModes.Error &&
         !this.raisedErrors.includes(this.lastStatusMode)
      ) {
         this.criticalError = true;
         this.raisedErrors.push(this.lastStatusMode);
         errorStr = 'The Human NIBP has encountered an error.';
      }

      if (this.lastStatusWarning != 0) {
         for (const nanoWarning of nanoWarningsArray) {
            if (
               nanoWarning.flag & kHandleWarningFlag &&
               nanoWarning.flag & this.lastStatusWarning
            ) {
               if (!this.raisedWarnings.includes(nanoWarning.flag)) {
                  // promote this particular warning to an error because of it's severity
                  if (nanoWarning.flag == WarningFlags.kManoBeDe_warn_NoPulse) {
                     // this is an interesting one, the pump appears to keep working after this warning
                     // has occured however it's hard to test as we could only get this to occur with
                     // have a whiteboard marker positioned correctly, TODO: test if it is actually recoverable...
                     // need 2 cuffs, and to switch to cuff 2 with a real finger in it after cuff 1 runs into this issue
                     this.criticalError = true;
                     errorStr = nanoWarning.message;

                     if (this.proxyDevice instanceof ProxyDevice) {
                        if (!this.raisedErrors.includes(nanoWarning.flag)) {
                           this.proxyDevice.displayError(
                              nanoWarning.message,
                              !this.continueOnError,
                              nanoWarning.flag.toString()
                           );
                           this.raisedErrors.push(nanoWarning.flag);

                           console.error(
                              this.deviceName + ' - ' + nanoWarning.message
                           );
                        }
                     }
                  } else {
                     if (
                        this.proxyDevice instanceof ProxyDevice &&
                        !this.criticalError // no point annotating errorenous warnings
                     ) {
                        this.proxyDevice.displayWarn(
                           nanoWarning.message,
                           nanoWarning.flag.toString(),
                           kDisplayNanoWarnings
                        );
                     }
                  }
                  this.raisedWarnings.push(nanoWarning.flag);
                  this.raisedWarningTimestamps.push(performance.now());
               }

               if (kLogAllWarnings) {
                  console.warn(this.deviceName + ' - ' + nanoWarning.message);
               }
            }
         }
      }

      // remove old warnings so they can be annotated again if they are relevant in future
      if (
         !!this.raisedWarnings.length &&
         performance.now() - this.raisedWarningTimestamps[0] >=
            kWarningAnnotationTimeoutms
      ) {
         // TODO: I want to use an iterator but javascript...cbf
         if (this.raisedWarnings.length > 1) {
            this.raisedWarnings = this.raisedWarnings.slice(
               1,
               this.raisedWarnings.length
            );
            this.raisedWarningTimestamps = this.raisedWarningTimestamps.slice(
               1,
               this.raisedWarnings.length
            );
         } else {
            this.raisedWarnings = [];
            this.raisedWarningTimestamps = [];
         }
      }

      if (this.criticalError) this.stopSampling(errorStr, this.continueOnError);
   }

   reportHCUStatus() {
      let hcuStatus = '';

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

      // Setting correct string value to hcuStatus.
      // It is displayed in the message under the HCU button.
      if (
         this.lastStatusError === NIBPErrorCodes.HcuContr_erro_hcuOffsetToBig ||
         this.lastStatusError === NIBPErrorCodes.HcuContr_erro_NotAllowed
      ) {
         const lastErrorCode = getErrorCode(this.lastStatusError);
         hcuStatus = NIBPErrors[lastErrorCode];
      }

      // Sending HCU status back to UI
      if (this.lastHCUStatusdata !== NanoHCUState.kHCUZeroingNow) {
         // Addding some timeout to be sure we catched last command response
         setTimeout(() => {
            if (
               this.proxyDevice instanceof ProxyDevice &&
               this.proxyDevice.hcuZeroCallback
            ) {
               this.proxyDevice.hcuZeroCallback(null, { hcuStatus });
            }
         }, 500);
      }
   }
} //NanoParser
