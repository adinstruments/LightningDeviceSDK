import {
   PacketType,
   packetTypeToSize,
   SampleLengthBytes,
   kMaxSizePacketType
} from './utils';
import { IDataSink, IDuplexStream } from '../../../public/device-api';
import { kNumberOfOrientationSignals } from './settings';
import { kEnableLogging } from './enableLogging';

const kFletcherSizeBytes = 4;

// Don't fire notifications into Lightning too often
const kMinimumSamplingUpdatePeriodms = 50;

const kCommandPacketID = 0xa0;
const kCommandCNT = 0x00;

export enum ParserState {
   kNoFletcherBytes,
   k1FletcherByte,
   k2FletcherByte,
   k3FletcherByte,
   kHasFletcher,
   kHasExpectedPacket,
   kUnexpectedPacket,
   kError
}

export enum SamplingState {
   kIdle,
   kSampling
}

export enum CommandPacketOp {
   setSampleRate = 0xa1,
   setChannelMask = 0xa2,
   formatMemory = 0xa3,
   disableModule = 0xa4,
   enabledModule = 0xa5,
   softReset = 0xa8,
   getDeviceInfo = 0xa9
}

const kFletcher = 0xdeadbeaf;
const kFletcherAF = 0xaf;
const kFletcherBE = 0xbe;
const kFletcherAD = 0xad;
const kFletcherDE = 0xde;

/**
 * Example parser for handling packets from example firmwares (e.g. DueLightning.ino and SAMDLightning.ino).
 * Each PhysicalDevice object creates a parser object which is always
 *  connected to its device stream. This is so that the parser can stay in
 *  synch with the bytes sent from the device.
 *
 * The incoming bytes are passed to the onData() method. These new bytes may contain part of a packet
 * or multiple packets.
 * To handle the case where an onData() call results in an incomplete packet, the parser buffers
 * any unprocessed bytes from previous onData() calls in its Parser.lastBuf member. The onData() method
 * first processes any incomplete packet by appending the new bytes required to complete
 * the packet onto the the existing bytes in lastBuf and then calling processBuffer() passing in lastBuf.
 *
 * Then it processes the remain new bytes by calling processBuffer() passing the newBytes and an offset
 * to indicate how many of the new bytes have already been processed.
 *
 * The parser is implemented as a finite state machine which processes incoming bytes in the buffer
 * passed to processBuffer(). For each new byte it switches to a new state depending on its current state
 * and the new  byte. Once it knows the type and size of an packet, it will return if newBytes does not contain
 * the complete packet.
 * If the complete packet is present it will call the appropriate method to process that type of
 * packet, e.g. processDataPacketPayload() or processTimePacketPayload().
 *
 */
export class Parser {
   parserState: ParserState;
   packetType: PacketType;
   packetPayloadSize = 0 | 0;
   samplingState: SamplingState = SamplingState.kIdle;

   expectedPacketCount: number; // is one byte (0 - 255)
   unexpectedPacketCount: number; //store the last unexpected count so we can resynch

   numberExgSignals: number; //from physical device
   numberExgSignalsFromSettings: number;

   digitGainShiftBits: number[];

   get firstOrientationInput() {
      return this.numberExgSignals || 8;
   }

   get firstEnvironmentInput() {
      return this.firstOrientationInput + kNumberOfOrientationSignals;
   }

   //We use a buffer containing the last partial packet to handle cases where a packet spans more that one chunk
   lastBuf: BufferWithLen;

   proxyDevice: IDataSink | null = null;

   lastError = '';
   lastUpdateTimems: number;

   // Normally the parser would not store this information.
   firmwareVersion?: number = undefined;
   dataRate: number;
   // Information needed so that we can accept samples, that would otherwise be of an unknown length.
   // If this is not set by a device info packet then we assume the device
   // is not connected. No sample data will be processed.
   ExG: number; // enabled channels bitset.

   lastRecievedCommand?: {
      opCode: CommandPacketOp;
      status: 'sent' | 'acknowledged' | 'completed' | 'error';
   };

   lastSentCommand?: {
      opCode: CommandPacketOp;
      status: 'sent' | 'acknowledged' | 'completed' | 'error';
   };

   acknowledgementTimeout?: NodeJS.Timeout;
   commandQueue: CommandPacket[] = [];

   constructor(public inStream: IDuplexStream, proxyDevice: IDataSink | null) {
      this.proxyDevice = proxyDevice;
      this.parserState = ParserState.kNoFletcherBytes;
      this.packetType = PacketType.kNotFound;
      this.packetPayloadSize = 0 | 0;
      this.expectedPacketCount = 0;
      this.unexpectedPacketCount = 0;

      // The largest packets are those of 8 channel data
      const maxPacketSizeBytes = packetTypeToSize(kMaxSizePacketType);
      this.lastBuf = new BufferWithLen(Buffer.alloc(maxPacketSizeBytes));

      //node streams default to 'utf8' encoding, which most devices won't understand.
      //With 'utf8' encoding, non-ascii chars, such as:
      //could be expanded into multiple bytes, so we use 'binary' instead.
      this.inStream.setDefaultEncoding('binary');
      this.inStream.on('error', this.onError);
      this.inStream.on('data', this.onData); //switches stream into flowing mode
   }

   setGain(streamIndex: number, range: number) {
      //range is in mV
      if (range === 400) this.digitGainShiftBits[streamIndex] = 0;
      else if (range === 100) this.digitGainShiftBits[streamIndex] = 2;
      else if (range === 50) this.digitGainShiftBits[streamIndex] = 3;
      else if (range === 25000) this.digitGainShiftBits[streamIndex] = 4;
      else if (range === 12500) this.digitGainShiftBits[streamIndex] = 5;
      else this.digitGainShiftBits[streamIndex] = 0; //unknown gain!
   }

   get32BitTimestampNow() {
      const timeStampNow = new Int32Array(2);
      this.inStream.source.getLocalSteadyClockTickNow(timeStampNow);
      return timeStampNow[0] | 0;
   }

   sendCommand(
      commandOp: CommandPacketOp,
      commandParam = 0,
      resetCommandQueue = false
   ) {
      if (resetCommandQueue) {
         this.commandQueue = [];
      }

      this.commandQueue.push(
         new CommandPacket(commandOp, commandParam, this.get32BitTimestampNow())
      );
      setTimeout(() => {
         this.doSendCommandFromQueue();
      });
   }

   private checkAndResetCommandTimeout() {
      if (this.lastRecievedCommand && this.lastSentCommand) {
         if (this.lastRecievedCommand.opCode === this.lastSentCommand.opCode) {
            this.lastSentCommand.status = this.lastRecievedCommand.status;

            this.proxyDevice &&
               this.proxyDevice.onPacket &&
               this.proxyDevice.onPacket(
                  PacketType.kCommandStatus,
                  this.lastSentCommand.opCode
               );
         } else {
            if (kEnableLogging)
               console.warn(
                  'Received unexpected command status op ' +
                     this.lastRecievedCommand.opCode +
                     ', expected ' +
                     this.lastSentCommand.opCode
               );
         }
      }

      if (!this.lastRecievedCommand && this.lastSentCommand) {
         if (kEnableLogging)
            console.warn(
               'Last command sent to MentaLab (' +
                  this.lastSentCommand.opCode +
                  ') was not acknowledged'
            );
      }

      if (this.acknowledgementTimeout) {
         clearTimeout(this.acknowledgementTimeout);
         this.acknowledgementTimeout = undefined;
         this.lastRecievedCommand = undefined;
      }
   }

   private doSendCommandFromQueue() {
      if (this.acknowledgementTimeout) {
         setTimeout(() => {
            this.doSendCommandFromQueue();
         });
         return;
      }

      const latestCommand = this.commandQueue.shift();

      if (latestCommand) {
         this.lastSentCommand = {
            opCode: latestCommand.opCode,
            status: 'sent'
         };

         this.inStream.write(latestCommand.getCommandPacketBuffer());

         this.acknowledgementTimeout = global.setTimeout(() => {
            this.checkAndResetCommandTimeout();
         }, 5000);
      }

      if (this.commandQueue.length > 0) {
         setTimeout(() => {
            this.doSendCommandFromQueue();
         });
      }
   }

   batteryPercentage(batteryVoltage: number): number {
      const voltage = batteryVoltage;

      if (voltage < 3.1) return 1;
      else if (voltage < 3.5) return 1 + ((voltage - 3.1) / 0.4) * 10;
      else if (voltage < 3.8) return 10 + ((voltage - 3.5) / 0.3) * 40;
      else if (voltage < 3.9) return 40 + ((voltage - 3.8) / 0.1) * 20;
      else if (voltage < 4.0) return 60 + ((voltage - 3.9) / 0.1) * 15;
      else if (voltage < 4.1) return 75 + ((voltage - 4) / 0.1) * 15;
      else if (voltage < 4.2) return 90 + ((voltage - 4.1) / 0.1) * 10;
      else return 100; // voltage > 4.2
   }

   incrementExpectedPacketCount() {
      this.expectedPacketCount++;
      this.expectedPacketCount &= 255;
      //++gSampleCountForTesting;
   }

   isSampling(): boolean {
      return (
         SamplingState.kIdle < this.samplingState &&
         this.samplingState <= SamplingState.kSampling
      );
   }

   onError = (err: Error) => {
      this.lastError = err.message;
      console.warn(err);

      if (this.proxyDevice) this.proxyDevice.onError(err);
      else console.warn(err);
   };

   setProxyDevice(
      proxyDevice: IDataSink | null,
      numberExgSignalsFromSettings = 0
   ) {
      this.proxyDevice = proxyDevice;
      this.numberExgSignalsFromSettings = numberExgSignalsFromSettings;
      this.digitGainShiftBits = new Array(numberExgSignalsFromSettings).fill(0);
   }

   startSampling(): boolean {
      if (!this.inStream || !this.proxyDevice) {
         return false;
      }

      this.samplingState = SamplingState.kSampling;
      this.proxyDevice.onSamplingStarted();
      this.lastUpdateTimems = performance.now();
      return true;
   }

   stopSampling(): boolean {
      this.samplingState = SamplingState.kIdle;
      if (!this.inStream) return false; // Can't sample if no hardware connection

      if (this.proxyDevice) this.proxyDevice.onSamplingStopped(''); // Normal user stop
      return true;
   }

   //returns the number of bytes processed from start of buffer, i.e. not from offset.
   processBuffer(buffer: Buffer, start: number, end: number) {
      let i = start;
      for (; i < end; ++i) {
         const byte = buffer[i];
         switch (this.parserState) {
            case ParserState.kNoFletcherBytes:
               if (byte === kFletcherAF) {
                  this.parserState = ParserState.k1FletcherByte;
               } else {
                  if (kEnableLogging)
                     console.log('Unexpected packets: ' + byte);
               }
               break;
            case ParserState.k1FletcherByte:
               if (byte === kFletcherBE) {
                  this.parserState = ParserState.k2FletcherByte;
               } else {
                  this.parserState = ParserState.kNoFletcherBytes;
                  i--; //retry this byte
               }
               break;
            case ParserState.k2FletcherByte:
               if (byte === kFletcherAD) {
                  this.parserState = ParserState.k3FletcherByte;
               } else {
                  this.parserState = ParserState.kNoFletcherBytes;
                  i--; //retry this byte
               }
               break;
            case ParserState.k3FletcherByte:
               if (byte === kFletcherDE) {
                  this.parserState = ParserState.kHasFletcher;
               } else {
                  this.parserState = ParserState.kNoFletcherBytes;
                  i--; //retry this byte
               }
               break;
            case ParserState.kHasFletcher: {
               switch (byte) {
                  case PacketType.kDeviceInfo:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kDeviceInfo;
                     break;
                  case PacketType.kAck:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kAck;
                     break;
                  case PacketType.kCommandStatus:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kCommandStatus;
                     break;
                  case PacketType.kENV:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kENV;
                     break;
                  case PacketType.kMarker:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kMarker;
                     break;
                  case PacketType.kEEG98:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kEEG98;
                     break;
                  case PacketType.kEEG98R:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kEEG98R;
                     break;
                  case PacketType.kEEG94:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kEEG94;
                     break;
                  case PacketType.kEEG94R:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kEEG94R;
                     break;
                  case PacketType.kORN:
                     this.parserState = ParserState.kHasExpectedPacket;
                     this.packetType = PacketType.kORN;
                     break;
                  default:
                     this.packetType = PacketType.kNotFound;
                     this.parserState = ParserState.kNoFletcherBytes;
                     break;
               }
               --i;
               break;
            }
            case ParserState.kUnexpectedPacket:
            case ParserState.kHasExpectedPacket: {
               // remove the 'fletcher'
               this.packetPayloadSize =
                  packetTypeToSize(this.packetType) - kFletcherSizeBytes;
               if (end - i < this.packetPayloadSize) {
                  //need more data before we can process the packet
                  return i;
               }
               const payloadStart = i;
               const payloadEnd = i + this.packetPayloadSize;
               if (!this.processPacketPayload(buffer.slice(i, payloadEnd))) {
                  i = payloadStart; //Start searching for a good packet!
               } else {
                  i = payloadEnd; //Finished this packet
               }
               this.packetType = PacketType.kNotFound;
               this.parserState = ParserState.kNoFletcherBytes;
               --i; //compensate for the for loop ++i that is about to happen before we go around again!
               break;
            }
         } //switch
      } //for
      return i;
   }

   onData = (newBytes: Buffer) => {
      if (!newBytes.length) {
         return;
      }
      let offsetInNew = 0;

      const unprocessed = this.lastBuf.len;
      if (unprocessed) {
         // assert(
         //    this.parserState === ParserState.kHasExpectedPacket ||
         //       this.parserState === ParserState.kUnexpectedPacket
         // );
         if (
            this.parserState === ParserState.kHasExpectedPacket ||
            this.parserState === ParserState.kUnexpectedPacket
         ) {
            //copy new bytes required to complete the current packet
            const desired = this.packetPayloadSize - unprocessed;
            //returns the number of bytes appended
            offsetInNew = this.lastBuf.appendFrom(newBytes, desired);
            if (this.lastBuf.len < this.packetPayloadSize) return; //need more data
         }
         const processed = this.processBuffer(
            this.lastBuf.buf,
            0,
            this.lastBuf.len
         );
         //assert(processed === this.lastBuf.len);
         if (processed < this.lastBuf.len) {
            //need more input to finish processing the last packet
            return;
         }
         //Finished processing previous data
         this.lastBuf.len = 0;
      }

      const processed = this.processBuffer(
         newBytes,
         offsetInNew,
         newBytes.length
      );

      if (processed < newBytes.length) {
         //need more input to finish processing the last packet.
         //copy the unprocessed bytes to the start of lastBuf
         this.lastBuf.copyFrom(newBytes, processed);
      }

      if (this.isSampling()) {
         const nowMilliseconds = performance.now();
         if (
            nowMilliseconds - this.lastUpdateTimems >
            kMinimumSamplingUpdatePeriodms
         ) {
            this.lastUpdateTimems = nowMilliseconds;
            if (this.proxyDevice) this.proxyDevice.onSamplingUpdate();
         }
      }
   };

   /**
    *
    * @param data [CNT, Fletcher). The full data packet excluding the packet
    * ID and the fletcher (which is effectively first 4 bytes but really
    * the tail of the previous packet)
    */
   processPacketPayload(data: Buffer) {
      if (!this.proxyDevice) {
         this.lastError =
            'Device parser processPacketPayLoad() called with no proxyDevice';
      }

      let ok = false;
      switch (this.packetType) {
         case PacketType.kDeviceInfo:
            ok = this.processDeviceInfoPacket(data);
            break;
         case PacketType.kAck:
            ok = this.processAck(data);
            break;
         case PacketType.kCommandStatus:
            ok = this.processCommandStatus(data);
            break;
         case PacketType.kENV:
            ok = this.processEnvironmentData(data);
            break;
         case PacketType.kMarker:
            ok = this.processMarker(data);
            break;
         case PacketType.kEEG98:
         case PacketType.kEEG98R:
         case PacketType.kEEG94:
         case PacketType.kEEG94R:
            ok = this.processDataPacketPayload(data);
            break;
         case PacketType.kORN:
            ok = this.processOrientationPacket(data);
            break;
         default:
            console.error(
               'processPacketPayLoad: unknown packet type: ',
               this.packetType
            );
            ok = false; //start searching for a new packet header
            break;
      }
      if (this.parserState === ParserState.kUnexpectedPacket) {
         this.expectedPacketCount = this.unexpectedPacketCount; //attempt to resynch
      }

      this.incrementExpectedPacketCount();

      return ok;
   }

   getNumberOfChannelsFromMask(channelMask: number) {
      let count = 0;
      while (channelMask > 0) {
         if ((channelMask & 1) === 1) {
            count++;
         }
         channelMask >>= 1;
      }
      return count;
   }

   /**
    * Checks if a given channel is active, in a given channel mask
    * @param channelMask The first byte of the status packet.
    * @param channelIndex zero based
    */
   isStreamOn(channelMask: number, channelIndex: number) {
      const channelIndexInt = channelIndex | 0;
      const channelMaskIndexInt = channelMask | 0;

      const chanBinary = 0b00000001 << channelIndexInt;
      return !!(chanBinary & channelMaskIndexInt);
   }

   /**
    *
    * @param data all bytes from a packet except the fletcher
    */
   processDeviceInfoPacket(data: Buffer) {
      // Because this device has variable data packet sizes, we need the EXG to to determine the expcted data pacet size. Only then can we accept sample data.
      this.firmwareVersion =
         data[data.length - 4] + (data[data.length - 3] << 8);

      this.dataRate = data[data.length - 2];
      this.ExG = data[data.length - 1]; // enabled channels bitset;

      this.numberExgSignals = this.getNumberOfChannelsFromMask(this.ExG);

      // This is only set up for testing so far.
      if (this.proxyDevice && this.proxyDevice.onPacket)
         this.proxyDevice.onPacket(this.packetType, null);

      return true;
   }

   processCommandStatus(data: Buffer) {
      const firstSampleIndex = data.length - SampleLengthBytes.kCommandStatus;
      const samples = data.slice(firstSampleIndex);
      if (samples.length !== SampleLengthBytes.kCommandStatus) {
         return false;
      }

      const opCode = samples[0];
      const commandStatus = samples[samples.length - 1];
      //Don't care about the recieved time

      this.lastRecievedCommand = {
         opCode,
         status: commandStatus === 1 ? 'completed' : 'error'
      };

      this.checkAndResetCommandTimeout();

      return true;
   }

   /**
    *
    * @param data all bytes from a packet except the fletcher
    */
   processAck(data: Buffer) {
      const opcode = data[data.length - 5];

      this.lastRecievedCommand = {
         opCode: opcode,
         status: 'acknowledged'
      };

      this.checkAndResetCommandTimeout();

      if (this.proxyDevice && this.proxyDevice.onPacket)
         this.proxyDevice.onPacket(this.packetType, opcode);

      return true;
   }

   shouldWriteBytes() {
      return this.proxyDevice && this.isSampling() && this.ExG;
   }

   /**
    * A user can push the button on the Mentalab device to send a 'marker' packet.
    * We treat that signal as a Lightning annotation.
    *
    * @param data
    */
   processMarker(data: Buffer) {
      // only process markers while sampling
      if (this.shouldWriteBytes() && this.proxyDevice) {
         const marker = data[data.length - 1];
         if (this.proxyDevice && this.proxyDevice.onPacket)
            this.proxyDevice.onPacket(this.packetType, marker);
      }
      return true;
   }

   /**
    *
    * @param data all bytes from a environment data packet except the fletcher
    */
   processEnvironmentData(data: Buffer) {
      const firstSampleIndex = data.length - SampleLengthBytes.kEnv;
      const samples = data.slice(firstSampleIndex);
      if (samples.length !== SampleLengthBytes.kEnv) {
         return false;
      }

      if (
         !this.proxyDevice ||
         !this.proxyDevice.inputToStream ||
         !this.shouldWriteBytes()
      )
         return true;

      const inputToStream = this.proxyDevice.inputToStream;
      const outStreamBuffers = this.proxyDevice.outStreamBuffers;

      let input = this.firstEnvironmentInput;

      let buffer = outStreamBuffers[inputToStream[input++]];
      if (buffer) buffer.writeInt(samples[0]); //temperature byte

      buffer = outStreamBuffers[inputToStream[input++]];
      if (buffer) {
         const light = samples[1] + (samples[2] << 8);
         buffer.writeInt(light);
      }

      buffer = outStreamBuffers[inputToStream[input++]];
      if (buffer) {
         const batteryVoltage =
            (16.8 / 6.8) * (1.8 / 2457) * (samples[3] + (samples[4] << 8));
         const batteryPercentage = this.batteryPercentage(batteryVoltage);
         buffer.writeInt(batteryPercentage);
      }

      return true;
   }

   /**
    *
    * @param data all bytes from either a 8 channel or 4 channel data packet
    *  16 samples expected
    *
    */
   processDataPacketPayload(data: Buffer) {
      const sampleLengthBytes =
         this.packetType === PacketType.kEEG98 ||
         this.packetType === PacketType.kEEG98R
            ? SampleLengthBytes.kEEG98
            : SampleLengthBytes.kEEG94;

      const firstSampleIndex = data.length - sampleLengthBytes;
      const samples = data.slice(firstSampleIndex);

      if (samples.length !== sampleLengthBytes) {
         return false;
      }

      // data is comprised of 16 samples over 8 or 4 channels
      const kSamplesPerPacket =
         this.packetType === PacketType.kEEG98 ||
         this.packetType === PacketType.kEEG98R
            ? 16
            : 33;
      const kChannelCount =
         this.packetType === PacketType.kEEG98 ||
         this.packetType === PacketType.kEEG98R
            ? 8
            : 4;
      const kStatusLengthBytes = 3;
      const kSampleLengthBytes = 3;

      let offset = 0;
      let channelMask = 0; // ads_mask in the docs

      if (
         !this.proxyDevice ||
         !this.proxyDevice.inputToStream ||
         !this.shouldWriteBytes()
      )
         return true;

      const inputToStream = this.proxyDevice.inputToStream;
      const outStreamBuffers = this.proxyDevice.outStreamBuffers;
      for (let j = 0; j < kSamplesPerPacket; j++) {
         channelMask = samples[offset];
         offset += kStatusLengthBytes;
         for (let i = 0; i < kChannelCount; ++i) {
            const streamIdx = inputToStream[i];
            const buffer = outStreamBuffers[streamIdx];
            if (buffer && this.isStreamOn(channelMask, i)) {
               let reading = samples.readIntLE(offset, kSampleLengthBytes);

               const shiftBits = this.digitGainShiftBits[streamIdx];

               // Just taking 16 bits for now. Despite the device supplying
               // a 24 bit sample, the low 8 bits are mostly ADC noise.
               let int16Val = reading >> (8 - shiftBits);

               const limit = 0x007fffff >> shiftBits;
               if (reading > limit) int16Val = 0x8000;
               //Out of range
               else if (reading < -limit) int16Val = 0x8000; //Out of range

               buffer.writeInt(int16Val);
            }
            offset += kSampleLengthBytes;
         }
      }

      return true;
   }

   warnForProxyDevice(dataType: string) {
      if (!this.proxyDevice) {
         this.lastError = `Parser is trying to process ${dataType} data with no proxyDevice`;
         console.log(this.lastError);
      }
   }

   processOrientationPacket(data: Buffer) {
      const firstSampleIndex = data.length - SampleLengthBytes.kORN;
      const samples = data.slice(firstSampleIndex);
      if (samples.length !== SampleLengthBytes.kORN) {
         return false;
      }

      if (
         !this.proxyDevice ||
         !this.proxyDevice.inputToStream ||
         !this.shouldWriteBytes()
      )
         return true;

      const inputToStream = this.proxyDevice.inputToStream;
      const uint16Bytesize = 2;

      const outStreamBuffers = this.proxyDevice.outStreamBuffers;

      //despite the docs, the temperature byte is not in the orientation packet!
      let input = this.firstOrientationInput;
      for (
         let offset = 0, end = input + kNumberOfOrientationSignals;
         input < end;
         ++input, offset += uint16Bytesize
      ) {
         let value = samples.readUInt16LE(offset);
         if (offset === 12) value = -value; //MagX needs inversion so the same units can be used for all Mag inputs
         const buffer = outStreamBuffers[inputToStream[input]];
         if (buffer) buffer.writeInt(value);
      }

      return true;
   }
}

class BufferWithLen {
   constructor(
      public buf: Buffer,
      public len = 0 //we are not always using the full buffer.length
   ) {}

   setNewBuffer(buffer: Buffer) {
      this.buf = buffer;
      this.len = buffer.length;
   }

   appendFrom(other: Buffer, desired: number) {
      const sourceEnd = Math.min(desired, other.length);
      const nCopied = other.copy(this.buf, this.len, 0, sourceEnd);
      this.len += nCopied;
      return nCopied;
   }

   copyFrom(other: Buffer, sourceStart: number) {
      //const sourceEnd = Math.min(desired, other.length);
      const nCopied = other.copy(this.buf, 0, sourceStart);
      this.len = nCopied;
      return nCopied;
   }
}

class CommandPacket {
   pid = kCommandPacketID; //uint 8/ 1 Byte
   cnt = kCommandCNT; //uint 8 / 1Byte
   payloadLength: number; //uint 16 2bytes
   hostTimestamp: number; //uint 32 4bytes
   opCode: CommandPacketOp; // 1 byte
   opParam: number; // 1 byte
   fletcher = kFletcher; // 4 bytes

   private packetSizeBytes = 14;

   constructor(opCode: CommandPacketOp, param = 0, timeStampNow: number) {
      this.opCode = opCode;
      this.opParam = param | 0;

      this.payloadLength = 10;
      this.hostTimestamp = timeStampNow;
   }

   getCommandPacketBuffer() {
      const byteBuffer = Buffer.alloc(this.packetSizeBytes);

      //write things into the buffer
      let offset = 0;
      offset = byteBuffer.writeUInt8(this.pid, offset);
      offset = byteBuffer.writeUInt8(this.cnt, offset);
      offset = byteBuffer.writeUInt16LE(this.payloadLength, offset);
      offset = byteBuffer.writeInt32LE(this.hostTimestamp | 0, offset);
      offset = byteBuffer.writeUInt8(this.opCode, offset);
      offset = byteBuffer.writeUInt8(this.opParam, offset);
      byteBuffer.writeUInt32LE(this.fletcher, offset);

      return byteBuffer;
   }
}
