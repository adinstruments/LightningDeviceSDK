import { Parser, ParserState } from '../../public/packet-parser';
import { IDuplexStream } from 'libs/quark';

import {
   DuplexDeviceConnection,
   IDataSink,
   IStreamBuffer,
   SerialPortOptions,
   TInt64,
   TimePoint,
   FirstSampleRemoteTime
} from '../../public/device-api';
import { isMapLike } from 'libs/serializr/src/utils/utils';

type ErrorListener = (err: Error) => {};
type DataListener = (chunk: Buffer | null) => {};

class MockDeviceConnection {
   devicePath: string;
   friendlyName: string;
   pnpId: string;
   vendorId: string;
   productId: string;
   manufacturer: string;
   serialNumber: string;

   start(): boolean {
      return true;
   } //returns true if started or already running
   stop(): void {}
   setReadHandler(
      callback: (error: Error | null, buffer: Int8Array | null) => void
   ): void {}
   onStreamDestroy(): void {} //reset the callback
   release(): void {}
   setOption(options: SerialPortOptions): void {}

   getLocalSteadyClockTickNow(timeTick: TInt64): void {}
   write(buffer: Buffer, callback: (error?: Error) => void): void {}
}

class MockStream implements IDuplexStream {
   onError: ErrorListener;
   onData: DataListener;
   source: MockDeviceConnection;

   constructor(source?: DuplexDeviceConnection /*, options?: DuplexOptions*/) {
      //super(options);
      //this.source = source;
      this.lastErr = null;
      this.timeoutms = 0;
      this.isRunning = false;
      //this.source.setReadHandler(this._readHandler);
      this.source = new MockDeviceConnection();
   }

   receive(data: number[]) {
      const buffer = Buffer.from(data);
      this.onData(buffer);
   }

   private _readHandler = (
      error: Error | null,
      chunk: Int8Array | null
   ): void => {
      if (error) {
         this.lastErr = error;
         this.isRunning = false;
      }
      // if (chunk && this.onData) {
      //    this.onData(chunk);
      // }
   };

   _write(
      chunk: any,
      encoding: BufferEncoding,
      callback: (error?: Error | null) => void
   ): void {}
   setDefaultEncoding(encoding: string): this {
      return this;
   }
   destroy(error?: Error): void {}

   isRunning: boolean;
   lastErr: Error | null;
   timeoutms: number;

   setReadTimeout(ms: number): void {}
   //   _read(size: number): void;
   //on: (event: string | symbol, listener: (...args: any[]) => void) => void;

   on(event: string | symbol, listener: (...args: any[]) => void) {
      if (event === 'error') {
         this.onError = listener as ErrorListener;
      } else if (event === 'data') {
         this.onData = listener as DataListener;
         if (!this.isRunning) {
            //The client is now interested in receiving data. Open the HW connection.
            this.isRunning = true; //this.source.start();
         }
      }
   }

   write(
      chunk: any,
      encoding?: BufferEncoding,
      cb?: (error: Error | null | undefined) => void
   ): boolean {
      return true;
   }
}

class MockStreamBuffer implements IStreamBuffer {
   writeInt(value: number): boolean {
      return true;
   }
}

class MockDataSink implements IDataSink {
   outStreamBuffers: MockStreamBuffer[];

   onSamplingStarted(): void {}
   onSamplingUpdate(): void {}
   onSamplingStopped(errorMsg: string): void {}
   onRemoteTimeEvent(
      error: Error | null,
      timePoint: TimePoint | FirstSampleRemoteTime | null
   ): void {}

   constructor(nStreams: number = 2) {
      this.outStreamBuffers = new Array();
      for (let i = 0; i < nStreams; ++i) {
         const buffer = new MockStreamBuffer();
         buffer.writeInt = jest.fn();
         this.outStreamBuffers.push(buffer);
      }

      this.onRemoteTimeEvent = jest.fn();
   }
}

describe('Parser', () => {
   it('initially handles a good data packet', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2); //2 ADC channels
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([0x50, 0xa0, 0x44, 0x00, 0x01, 0x02, 0x03, 0x04]);

      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('handles good 3 channel data packets when only 2 streams enabled', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 3); //3 ADC channels
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x50, //start
         0xa0,
         0x44,
         0x00, //packet number
         0x01,
         0x02,
         0x03,
         0x04,
         0x05,
         0x06
      ]);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);

      stream.receive([
         0x50, //start
         0xa0,
         0x44,
         0x01, //packet number
         0x07,
         0x08,
         0x09,
         0x0a,
         0x0b,
         0x0c
      ]);

      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledTimes(2);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(2);
   });

   it('handles good 3 channel data packets when 3 streams enabled', () => {
      const kADCChannels = 3;
      const stream = new MockStream();
      const parser = new Parser(stream, kADCChannels); //3 ADC channels
      const dataSink = new MockDataSink(kADCChannels);

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x50, //start
         0xa0,
         0x44,
         0x00, //packet number
         0x01,
         0x02,
         0x03,
         0x04,
         0x05,
         0x06
      ]);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
      expect(dataSink.outStreamBuffers[2].writeInt).toBeCalledWith(0x0605);

      stream.receive([
         0x50, //start
         0xa0,
         0x44,
         0x01, //packet number
         0x07,
         0x08,
         0x09,
         0x0a,
         0x0b,
         0x0c
      ]);

      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledTimes(2);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(2);
      expect(dataSink.outStreamBuffers[2].writeInt).toBeCalledTimes(2);
   });

   it('finds a good packet preceded by some junk bytes when not sampling', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      expect(parser.expectedPacketCount).toEqual(0);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      stream.receive([
         0x50,
         0x50, //packet start
         0xa0,
         0x44,
         0x00,
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(parser.expectedPacketCount).toEqual(1);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      // it should not push samples to the data sink
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledTimes(0);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
   });

   it('finds a good packet preceded by bad packet header when not sampling', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      expect(parser.expectedPacketCount).toEqual(0);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      stream.receive([
         0x50,
         0xa0,
         0x50, //invalid packet type
         0x50, //packet start
         0xa0,
         0x44,
         0x00,
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(parser.expectedPacketCount).toEqual(1);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      // it should not push samples to the data sink
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledTimes(0);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
   });

   it('finds a good packet preceded by bad packet header type when not sampling', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      expect(parser.expectedPacketCount).toEqual(0);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      stream.receive([
         0x50,
         0xa0,
         0x4f, //invalid packet type
         0x50, //packet start
         0xa0,
         0x44,
         0x00,
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(parser.expectedPacketCount).toEqual(1);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      // it should not push samples to the data sink
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledTimes(0);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
   });

   it('finds a good packet preceded by some junk bytes when drip fed bytes while not sampling', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      expect(parser.expectedPacketCount).toEqual(0);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      stream.receive([0x50]);
      stream.receive([0xa0]);
      stream.receive([0x50]); //Packet start
      stream.receive([0xa0]);
      stream.receive([0x44]);
      stream.receive([0x00]);
      stream.receive([0x01]);
      stream.receive([0x02]);
      stream.receive([0x03]);
      stream.receive([0x04]);

      expect(parser.expectedPacketCount).toEqual(1);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      // it should not push samples to the data sink
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledTimes(0);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
   });

   it('adds a packet when sampling after receiving packet while not sampling', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      expect(parser.expectedPacketCount).toEqual(0);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      stream.receive([
         0x10,
         0xc0,
         0x50, //packet start
         0xa0,
         0x44,
         0x00, //packet number
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(parser.expectedPacketCount).toEqual(1);
      expect(parser.parserState).toEqual(ParserState.kNoHeaderBytes);

      // it should not push samples to the data sink
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledTimes(0);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50, //packet start
         0xa0,
         0x44,
         0x01, //packet number
         0x01,
         0x02,
         0x03,
         0x05
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(1);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0503);
   });

   it('finds a good packet preceded by some junk bytes', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50, //packet start
         0xa0,
         0x44,
         0x00,
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(1);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('finds a good packet preceded by some junk bytes received byte by byte', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();
      stream.receive([0x10]);

      stream.receive([
         0x10,
         0xc0,
         0x50, //packet start
         0xa0,
         0x44,
         0x00,
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(1);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('finds a good packet spread across chunks', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50 //packet start
      ]);

      stream.receive([0xa0, 0x44, 0x00, 0x01, 0x02, 0x03]);

      stream.receive([0x04]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(1);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('fails to find an incomplete packet in a chunk larger than a packet', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50, //packet start
         0xa0,
         0x44,
         0x00,
         0x01,
         0x02,
         0x03
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
   });

   it('finds a good packet spread across chunks after large initial chunk', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50, //packet start
         0xa0,
         0x44,
         0x00,
         0x01,
         0x02,
         0x03
      ]);

      stream.receive([0x04]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(1);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('finds multiple packets spread across chunks', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50 //packet start
      ]);

      stream.receive([0xa0, 0x44, 0x00, 0x01, 0x02, 0x03]);

      stream.receive([
         0x04,
         0x50, //packet start
         0xa0,
         0x44,
         0x01, //packet number
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(2);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('finds multiple packets spread across chunks with junk in between', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50 //packet start
      ]);

      stream.receive([0xa0, 0x44, 0x00, 0x01, 0x02, 0x03]);

      stream.receive([
         0x04,
         0x10,
         0xc0,
         0x50, //packet start
         0xa0,
         0x44,
         0x01, //packet number
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(2);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('handles a chunk with multiple packets', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50 //packet start
      ]);

      stream.receive([0xa0, 0x44, 0x00, 0x01, 0x02, 0x03]);

      stream.receive([
         0x04,
         0x50, //packet start
         0xa0,
         0x44,
         0x01, //packet number
         0x01,
         0x02,
         0x03,
         0x04, //packet end
         0x50, //packet start
         0xa0,
         0x44,
         0x02, //packet number
         0x01,
         0x02,
         0x03,
         0x04 //packet end
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(3);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0403);
   });

   it('handles a chunk with multiple packets with junk in betweeen', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50 //packet start
      ]);

      stream.receive([0xa0, 0x44, 0x00, 0x01, 0x02, 0x03]);

      stream.receive([
         0x04,
         0x50, //packet start
         0xa0,
         0x44,
         0x01, //packet number
         0x01,
         0x02,
         0x03,
         0x04, //packet end
         0x0a, //junk
         0x0d,
         0x50, //packet start
         0xa0,
         0x44,
         0x02, //packet number
         0x01,
         0x02,
         0x03,
         0x05 //packet end
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(3);
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0503);
   });

   it('inserts one packets worth of samples if one packet is missing', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50 //packet start
      ]);

      stream.receive([0xa0, 0x44, 0x00, 0x01, 0x02, 0x03]);

      stream.receive([
         0x04,
         0x50, //packet start
         0xa0,
         0x44,
         0x01, //packet number
         0x01,
         0x02,
         0x03,
         0x04, //packet end
         0x0a, //junk
         0x0d,
         0x50, //packet start after missing packet
         0xa0,
         0x44,
         0x03, //packet number after missing packet
         0x01,
         0x02,
         0x03,
         0x05, //packet end
         0x50, //packet start
         0xa0,
         0x44,
         0x04, //packet number
         0x01,
         0x02,
         0x03,
         0x06 //packet end
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(5); //inserts missing packet
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0603);
   });

   it('handles an incomplete packet gracefully', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x10,
         0xc0,
         0x50 //packet start
      ]);

      stream.receive([0xa0, 0x44, 0x00, 0x01, 0x02, 0x03]);

      stream.receive([
         0x04,
         0x50, //packet start
         0xa0,
         0x14, //bad header nibble
         0x50, //packet start
         0xa0,
         0x44,
         0x01, //packet number
         0x01,
         0x02,
         0x03,
         0x06 //packet end
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(2); //inserts missing packet
      expect(dataSink.outStreamBuffers[0].writeInt).toBeCalledWith(0x0201);
      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledWith(0x0603);
   });
});

describe('For time packets, parser ', () => {
   it('handles a good time packet while not sampling', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.getRemoteTime();

      stream.receive([
         0x50,
         0xa0,
         0x4e, //packet type: Time
         0x00, //packet count
         0x00, //time request number
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
      expect(dataSink.onRemoteTimeEvent).toBeCalledTimes(1);

      const timePoint = new TimePoint();
      timePoint.remoteTimeTick[0] = 0x04030201;
      timePoint.remoteTimeTick[1] = 0;

      expect(dataSink.onRemoteTimeEvent).toBeCalledWith(null, timePoint);
   });

   it('does not use a time response with the wrong time request number', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.getRemoteTime();

      stream.receive([
         0x50,
         0xa0,
         0x4e, //packet type: Time
         0x00, //packet count
         0x00, //time request number
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      parser.getRemoteTime();

      stream.receive([
         0x50,
         0xa0,
         0x4e, //packet type: Time
         0x01, //packet count
         0x02, //time request number
         0x01,
         0x02,
         0x03,
         0x05
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
      expect(dataSink.onRemoteTimeEvent).toBeCalledTimes(1);

      const timePoint = new TimePoint();
      timePoint.remoteTimeTick[0] = 0x04030201;
      timePoint.remoteTimeTick[1] = 0;

      expect(dataSink.onRemoteTimeEvent).toBeCalledWith(null, timePoint);
   });

   it('increments time request number correctly', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.getRemoteTime();

      stream.receive([
         0x50,
         0xa0,
         0x4e, //packet type: Time
         0x00, //packet count
         0x00, //time request number
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      parser.getRemoteTime();

      stream.receive([
         0x50,
         0xa0,
         0x4e, //packet type: Time
         0x01, //packet count
         0x01, //time request number
         0x01,
         0x02,
         0x03,
         0x05
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
      expect(dataSink.onRemoteTimeEvent).toBeCalledTimes(2);

      const timePoint = new TimePoint();
      timePoint.remoteTimeTick[0] = 0x05030201;
      timePoint.remoteTimeTick[1] = 0;

      expect(dataSink.onRemoteTimeEvent).toBeCalledWith(null, timePoint);
   });

   it('increments time request number correctly to avoid sending line feed command terminator', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      while (parser.expectedTimeRequestNumber < '\n'.charCodeAt(0) - 1)
         parser.incrementTimeRequestNumber();

      expect(parser.expectedTimeRequestNumber).toBe(9);
      parser.getRemoteTime();
      expect(parser.expectedTimeRequestNumber).toBe(11);

      stream.receive([
         0x50,
         0xa0,
         0x4e, //packet type: Time
         0x00, //packet count
         0x0b, //time request number
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
      expect(dataSink.onRemoteTimeEvent).toBeCalledTimes(1);

      const timePoint = new TimePoint();
      timePoint.remoteTimeTick[0] = 0x04030201;
      timePoint.remoteTimeTick[1] = 0;

      expect(dataSink.onRemoteTimeEvent).toBeCalledWith(null, timePoint);
   });

   it('handles a good first sample time packet while sampling', () => {
      const stream = new MockStream();
      const parser = new Parser(stream, 2);
      const dataSink = new MockDataSink();

      parser.setProxyDevice(dataSink);

      parser.startSampling();

      stream.receive([
         0x50,
         0xa0,
         0x46, //packet type: First Sample Time
         0x00, //packet count
         0x01,
         0x02,
         0x03,
         0x04
      ]);

      expect(dataSink.outStreamBuffers[1].writeInt).toBeCalledTimes(0);
      expect(dataSink.onRemoteTimeEvent).toBeCalledTimes(1);

      const timePoint = new FirstSampleRemoteTime();
      timePoint.remoteFirstSampleTick[0] = 0x04030201;
      timePoint.remoteFirstSampleTick[1] = 0;

      expect(dataSink.onRemoteTimeEvent).toBeCalledWith(null, timePoint);
   });
});
