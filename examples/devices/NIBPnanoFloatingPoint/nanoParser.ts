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
   kBaseVersionInfo,
   VersionPacketType
} from './constants';
import { ProxyDevice } from './proxy';
import { INIBPSettings } from './settings';
import {
   CheckCRC,
   getKeyByValue,
   findVersionInfoData,
   packetTypeToLength
} from './utils';
import {
   nanoErrorArray,
   nanoWarningsArray,
   kManoBeDe_warn_NoPulse
} from './errorMessages';
import { kEnableLogging } from './enableLogging';

enum SamplingState {
   kIdle,
   kSampling
}

// Don't fire notifications into Lightning too often
const kMinimumSamplingUpdatePeriodms = 50;
const kMinimumKeepAlivePeriodms = 500;

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
   lastCuffCountdowndataMins: number;
   _lastCuffCountdownSecs: number;
   _lastAutoCalCountdowndata: number;

   cuffTimer: number;

   beat2BPacketCount: number;

   dataPadTimerms: number;

   lastHCUStatusdata: number;
   lastStatusError: number;
   lastStatusWarning: number;
   haveWarnedHCUNotZeroed: boolean;

   criticalError: boolean;
   raisedErrors: number[];
   raisedWarnings: string[];
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

   get lastHeightAverageScaled() {
      return this._lastHeightAverage;
   }

   // Scaled data accessors
   get lastSysDataScaled() {
      return this._lastSYSdata;
   }
   get lastMAPDataScaled() {
      return this._lastMAPdata;
   }
   get lastDiaDataScaled() {
      return this._lastDIAdata;
   }

   get lastHRDataBper10minScaled() {
      return this._lastHRdataBper10min;
   }

   get lastIBIDataScaled() {
      return this._lastIBIdata;
   }

   get lastActiveCuffScaled() {
      return this._lastActiveCuff;
   }
   get lastCuffCountdownSecsScaled() {
      return this._lastCuffCountdownSecs;
   }
   get lastAutoCalCountdownDataScaled() {
      return this._lastAutoCalCountdowndata;
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
      this.lastCuffCountdowndataMins = 0;
      this._lastCuffCountdownSecs = 0;
      this._lastAutoCalCountdowndata = 0;
      this.lastHCUStatusdata = -1;

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
            this.lastCuffCountdowndataMins = -1; // force an update
            break;

         case CuffMode.SwitchCuffs:
            this.setCuffSwitchInterval(this.cuffSwitchingInterval);
            this.inStream.write(NanoTxSampCmds.resetCuffScheduler());
            this.lastCuffCountdowndataMins = -1; // force an update
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
   }

   setContinueOnError(enabled: boolean) {
      this.continueOnError = enabled;
   }

   isSampling() {
      return this.samplingState == SamplingState.kSampling;
   }

   onError(err: Error) {
      this.lastError = err.message;
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
      this.lastCuffCountdowndataMins = -1; // force an update
      this._lastCuffCountdownSecs = 0;
      this._lastAutoCalCountdowndata = 0;

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

      return true;
   }

   stopSampling(err = '', contOnErr = false) {
      this.exitCurrentMode();

      if (contOnErr) {
         // zerofy the padded data
         this._lastSYSdata = 0;
         this._lastMAPdata = 0;
         this._lastDIAdata = 0;
         this._lastHRdataBper10min = 0;
         this._lastIBIdata = 0;
         this._lastActiveCuff = 0;
         this.lastCuffCountdowndataMins = -1;
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

      if (nextPacketStart <= this.mBuffer.length)
         // will always be
         this.mBuffer = this.mBuffer.slice(
            nextPacketStart,
            this.mBuffer.length
         );
      else this.mBuffer = null;

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
         !!this.lastPhysiocalState && // > kPhysiocalOff = 0x00
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
         return; // Something has gone terribly wrong
      }

      const totalExpectedSamples =
         ((performance.now() - this.dataPadTimerms) *
            kSupportedSamplesPerSec[0]) /
         1000;

      while (this.dataSampleSampleCount < totalExpectedSamples - 1) {
         this.proxyDevice.outStreamBuffers[NanoChannels.kBP].writeInt(0);
         this.proxyDevice.outStreamBuffers[NanoChannels.kBPHC].writeInt(0);
         this.proxyDevice.outStreamBuffers[NanoChannels.kHGT].writeInt(0);
         this.proxyDevice.outStreamBuffers[NanoChannels.kQualLevel].writeInt(0);

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
         cmdpos - kCmdBytePacketOffset < 0 ||
         cmdpos + packetTypeToLength(packetType) > buffer.length
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

      let dataPacketCheck = true;
      for (let i = 0; i < sampCmd.length; ++i) {
         // iterate over the previous bytes to make sure it matches expected answer
         dataPacketCheck =
            dataPacketCheck &&
            sampCmd[i] == buffer[cmdpos - kCmdBytePacketOffset + i];
      }

      return dataPacketCheck;
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
            packetTypeToLength(PacketType.Beat2BDataTransmission) -
            kCmdBytePacketOffset
         );

      this.runCheckCRC(byteArray, dcmdPos, NanoRxSampCmds.kDataCmdHead[1]);

      let currentTimeStamp = byteArray.readUInt16LE(dcmdPos + 1);

      if (!this.lastB2bTimeStamp && !this.beat2BPacketCount)
         this.lastB2bTimeStamp = currentTimeStamp;

      if (
         kEnableLogging &&
         this.expectedDataTransmissionTimeStamp &&
         currentTimeStamp != this.expectedDataTransmissionTimeStamp
      ) {
         console.log('Data currentTimeStamp: ' + currentTimeStamp);
         console.log(
            'Data expectedTimeStamp: ' + this.expectedDataTransmissionTimeStamp
         );

         if (currentTimeStamp >= 2 ** 16) currentTimeStamp = -1;

         this.expectedDataTransmissionTimeStamp = currentTimeStamp + 1;
      }

      // signed 16bit values, 1/10 mmHg
      let BPdataDecimmHg = byteArray.readInt16LE(dcmdPos + 3);
      const HGTdataDecimmHg = byteArray.readInt16LE(dcmdPos + 5);
      const qualityLevel = byteArray[dcmdPos + 9] & 0x0f;

      console.log(HGTdataDecimmHg);
      // zerofies crufty pre-sampling nano-spew data at start of record
      if (BPdataDecimmHg > kPressureRangeMaxMmHg * kConversionFactor)
         BPdataDecimmHg = 0x00;

      const HGTShortValue = (HGTdataDecimmHg << 16) >> 16;
      this.HGTValuesBetweenBeat.push(HGTShortValue);

      this.proxyDevice.outStreamBuffers[NanoChannels.kBP].writeInt(
         BPdataDecimmHg
      );
      this.proxyDevice.outStreamBuffers[NanoChannels.kBPHC].writeInt(
         BPdataDecimmHg + HGTShortValue
      );

      // These values are scaled for autoscale
      this.proxyDevice.outStreamBuffers[NanoChannels.kHGT].writeInt(
         HGTdataDecimmHg
      );
      this.proxyDevice.outStreamBuffers[NanoChannels.kQualLevel].writeInt(
         qualityLevel
      );

      ++this.beat2BPadSampleCount;
      ++this.statusPadSampleCount;
      ++this.dataSampleSampleCount;

      if (!this.dataPadTimerms)
         // startTickms effectively
         this.dataPadTimerms = performance.now();

      return (
         dcmdPos +
         packetTypeToLength(PacketType.DataTransmission) -
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
            packetTypeToLength(PacketType.Beat2BDataTransmission) -
            kCmdBytePacketOffset
         );

      ++this.beat2BPacketCount; // used for physioCal setting

      // no sample count check as these packets arrive aperiodically
      this.runCheckCRC(byteArray, bcmdPos, NanoRxSampCmds.kBeat2bCmdHead[1]);

      const B2bTimestamp = byteArray.readUInt16LE(bcmdPos + 1);

      if (B2bTimestamp < this.lastB2bTimeStamp) this.lastB2bTimeStamp -= 65535; // account for wrapping (2^16 - 1)

      // retroactively fill in beat2Beat data with latest data
      while (this.lastB2bTimeStamp < B2bTimestamp) {
         this.proxyDevice.outStreamBuffers[NanoChannels.kSYS].writeInt(
            this.lastSysDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kSYSHC].writeInt(
            this.hcLastSysDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kMAP].writeInt(
            this.lastMAPDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kMAPHC].writeInt(
            this.hcLastMAPDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kDIA].writeInt(
            this.lastDiaDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kDIAHC].writeInt(
            this.hcLastDiaDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kHR].writeInt(
            this.lastHRDataBper10minScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kIBI].writeInt(
            this.lastIBIDataScaled
         );

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
         packetTypeToLength(PacketType.Beat2BDataTransmission) -
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
            scmdPos +
            packetTypeToLength(PacketType.Status) -
            kCmdBytePacketOffset
         );

      let currentTimeStamp = byteArray.readUInt16LE(scmdPos + 1);

      if (
         kEnableLogging &&
         this.expectedStatusTimeStamp &&
         currentTimeStamp != this.expectedStatusTimeStamp
      ) {
         console.log('status currentTimeStamp: ' + currentTimeStamp);
         console.log(
            'status expectedTimeStamp: ' + this.expectedStatusTimeStamp
         );

         if (currentTimeStamp >= 2 ** 16)
            currentTimeStamp = -kDataSamplesPerStatusSample;

         this.expectedStatusTimeStamp =
            currentTimeStamp + kDataSamplesPerStatusSample;
      }

      const activeCuff = byteArray[scmdPos + 10] & 0x03;

      if (!!activeCuff && this._lastActiveCuff != activeCuff) {
         this._lastActiveCuff = activeCuff;

         if (this.proxyDevice && this.proxyDevice instanceof ProxyDevice)
            this.proxyDevice.addAnnotation(
               'Switching to Cuff ' + this._lastActiveCuff
            );
      }

      let cuffCountdownMins = byteArray[scmdPos + 10] >> 2;
      this._lastAutoCalCountdowndata = this.enablePhysioCal
         ? byteArray[scmdPos + 12]
         : 0;

      // 0x00 = Automatic cuff control is disabled
      // 0x3E = 62 = Switching (or enabling) cuff now
      if (cuffCountdownMins > 61) cuffCountdownMins = 0;

      this._lastCuffCountdownSecs = 0;

      if (cuffCountdownMins) {
         if (this.lastCuffCountdowndataMins != cuffCountdownMins) {
            this.lastCuffCountdowndataMins = cuffCountdownMins;
            this._lastCuffCountdownSecs = cuffCountdownMins * 60;
            this.cuffTimer = performance.now() / 1000;
         } else {
            const nowSec = performance.now() / 1000;
            this._lastCuffCountdownSecs =
               cuffCountdownMins * 60 - (nowSec - this.cuffTimer);
         }
      }

      this.proxyDevice.outStreamBuffers[NanoChannels.kActiveCuff].writeInt(
         this.lastActiveCuffScaled
      );
      this.proxyDevice.outStreamBuffers[NanoChannels.kCuffCountdown].writeInt(
         this.lastCuffCountdownSecsScaled
      );
      this.proxyDevice.outStreamBuffers[
         NanoChannels.kAutoCalCountdown
      ].writeInt(this.lastAutoCalCountdownDataScaled);

      --this.statusPadSampleCount;

      return (
         scmdPos + packetTypeToLength(PacketType.Status) - kCmdBytePacketOffset
      );
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
               console.log('Not a version packet');
               return (
                  pos +
                  packetTypeToLength(PacketType.VersionInfo) -
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
            console.log('Not a version packet');
         }
      }

      return (
         pos + packetTypeToLength(PacketType.VersionInfo) - kCmdBytePacketOffset
      );
   }

   padBeatToBeatDataTransmissionPacketData() {
      if (!this.proxyDevice || !this.isSampling()) return;

      // this is used only when continue on error is true
      while (this.beat2BPadSampleCount > 0) {
         this.proxyDevice.outStreamBuffers[NanoChannels.kSYS].writeInt(
            this.lastSysDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kSYSHC].writeInt(
            this.hcLastSysDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kMAP].writeInt(
            this.lastMAPDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kMAPHC].writeInt(
            this.hcLastMAPDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kDIA].writeInt(
            this.lastDiaDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kDIAHC].writeInt(
            this.hcLastDiaDataScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kHR].writeInt(
            this.lastHRDataBper10minScaled
         );
         this.proxyDevice.outStreamBuffers[NanoChannels.kIBI].writeInt(
            this.lastIBIDataScaled
         );

         --this.beat2BPadSampleCount;
      }
   }

   padLowRateStatusData() {
      if (!this.proxyDevice || !this.isSampling()) return;

      // Upsample status data to pressure data
      while (this.statusPadSampleCount > 0) {
         this.proxyDevice.outStreamBuffers[NanoChannels.kActiveCuff].writeInt(
            this.lastActiveCuffScaled
         );
         this.proxyDevice.outStreamBuffers[
            NanoChannels.kCuffCountdown
         ].writeInt(this.lastCuffCountdownSecsScaled);
         this.proxyDevice.outStreamBuffers[
            NanoChannels.kAutoCalCountdown
         ].writeInt(this.lastAutoCalCountdownDataScaled);

         --this.statusPadSampleCount;
      }
   }

   calcHeightAverage(): number {
      let counter = 0;
      let sum = 0;

      this.HGTValuesBetweenBeat.forEach((value) => {
         sum += value;
         ++counter;
      });

      if (counter === 0) return 0;

      return sum / counter;
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
            this.proxyDevice &&
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
         this.proxyDevice &&
         this.proxyDevice instanceof ProxyDevice
      ) {
         this.haveWarnedHCUNotZeroed = true;
         this.proxyDevice.displayWarn('HCU not zeroed', 'HCUNOTZEROED', true);
      }

      let errorStr = '';

      if (this.lastStatusError != 0) {
         if (this.lastStatusError !== 43 && this.lastStatusError !== 44) {
            // HCU zeroing related, not actual errors
            if (this.proxyDevice && this.proxyDevice instanceof ProxyDevice) {
               if (!this.raisedErrors.includes(this.lastStatusError)) {
                  this.proxyDevice.displayError(
                     nanoErrorArray[this.lastStatusError][1],
                     !this.continueOnError,
                     nanoErrorArray[this.lastStatusError][0]
                  );

                  this.raisedErrors.push(this.lastStatusError);
               }

               if (kEnableLogging)
                  console.error(
                     this.deviceName +
                        ' - ' +
                        nanoErrorArray[this.lastStatusError][1]
                  );
            }

            this.criticalError = true;
         }

         errorStr = nanoErrorArray[this.lastStatusError][1];
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
         for (const nanoWarningCode in nanoWarningsArray) {
            if ((this.lastStatusWarning & parseInt(nanoWarningCode, 10)) != 0) {
               if (!this.raisedWarnings.includes(nanoWarningCode)) {
                  // TODO: remove this
                  // promote this particular warning to an error because of it's severity
                  if (
                     nanoWarningCode ==
                     getKeyByValue(nanoWarningsArray, 'ManoBeDe_warn_NoPulse')
                  ) {
                     if (
                        this.proxyDevice &&
                        this.proxyDevice instanceof ProxyDevice
                     ) {
                        if (
                           !this.raisedErrors.includes(kManoBeDe_warn_NoPulse)
                        ) {
                           this.proxyDevice.displayError(
                              nanoWarningsArray[nanoWarningCode],
                              !this.continueOnError,
                              nanoWarningCode
                           );

                           this.raisedErrors.push(kManoBeDe_warn_NoPulse);
                        }
                     }

                     // this is an interesting one, the pump appears to keep working after this warning
                     // has occured however it's hard to test as we could only get this to occur with
                     // have a whiteboard marker positioned correctly, TODO: test if it is actually recoverable...
                     // need 2 cuffs, and to switch to cuff 2 with a real finger in it after cuff 1 runs into this issue
                     this.criticalError = true;
                     errorStr = nanoWarningsArray[nanoWarningCode];
                  } else {
                     if (
                        this.proxyDevice &&
                        this.proxyDevice instanceof ProxyDevice
                     ) {
                        this.proxyDevice.displayWarn(
                           nanoWarningsArray[nanoWarningCode],
                           nanoWarningCode,
                           kDisplayNanoWarnings
                        );
                     }
                  }

                  this.raisedWarnings.push(nanoWarningCode);
                  this.raisedWarningTimestamps.push(performance.now());
               }

               if (kEnableLogging) {
                  console.warn(
                     this.deviceName +
                        ' - ' +
                        nanoWarningsArray[nanoWarningCode]
                  );
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
      if (this.lastStatusError === 43 || this.lastStatusError === 44)
         hcuStatus = nanoErrorArray[this.lastStatusError][1];

      // Sending HCU status back to UI
      if (this.lastHCUStatusdata !== NanoHCUState.kHCUZeroingNow) {
         // Addding some timeout to be sure we catched last command response
         setTimeout(() => {
            if (
               this.proxyDevice &&
               this.proxyDevice instanceof ProxyDevice &&
               this.proxyDevice.hcuZeroCallback
            ) {
               this.proxyDevice.hcuZeroCallback(null, { hcuStatus });
            }
         }, 500);
      }
   }
} //NanoParser
