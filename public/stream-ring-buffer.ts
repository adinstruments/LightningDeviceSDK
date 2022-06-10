import { StreamRingBuffer, BlockDataFormat } from './device-api'; //'libs/quark-sys';

function getDefaultBytesFromFormat(dataFormat: BlockDataFormat): number {
   switch (dataFormat) {
      case BlockDataFormat.k12BitBlockDataFormat:
      case BlockDataFormat.k16BitBlockDataFormat:
         return 2;

      case BlockDataFormat.kFloatBlockDataFormat:
         return 4;

      case BlockDataFormat.k32BitBlockDataFormat:
      case BlockDataFormat.kDoubleBlockDataFormat:
         throw 'kDoubleBlockDataFormat, not supported currently';

      default:
         return 2;
   }
}

export class StreamRingBufferImpl implements StreamRingBuffer {
   //public JS interface
   indexInDevice: number;
   lenMask: number;

   calcPow2n(minLength: number): number {
      let pow2n = 2;
      while (pow2n && pow2n < minLength) pow2n <<= 1;

      return pow2n;
   }

   constructor(
      indexInDevice: number,
      minSizeInSamples: number,
      private blockDataFormat = BlockDataFormat.k16BitBlockDataFormat
   ) {
      this.indexInDevice = indexInDevice;
      this.inIndex = 0;
      this.outIndex = 0;

      const bytesPerSample = getDefaultBytesFromFormat(this.blockDataFormat);

      const sizePow2 = this.calcPow2n(minSizeInSamples);
      this.lenMask = sizePow2 - 1;

      const sizeBytes = sizePow2 * bytesPerSample;

      //Potential crashes in v8 heap when using node.Buffer to share memory with Quark
      //from web workers!
      //this.ringBufferBuffer = Buffer.allocUnsafe(sizeBytes);

      const sharedBuffer = new SharedArrayBuffer(sizeBytes);
      this.ringBufferBuffer = sharedBuffer;

      //ringBufferBuffer shares ringBuffer's memory
      this.createRingBuffer(this.blockDataFormat);
   }

   createRingBuffer(dataFormat: BlockDataFormat) {
      if (!this.ringBufferBuffer) {
         return;
      }

      switch (dataFormat) {
         case BlockDataFormat.k12BitBlockDataFormat:
         case BlockDataFormat.k16BitBlockDataFormat: {
            this.ringBuffer = new Int16Array(this.ringBufferBuffer);
            break;
         }

         case BlockDataFormat.kFloatBlockDataFormat: {
            this.ringBuffer = new Float32Array(this.ringBufferBuffer);
            break;
         }

         case BlockDataFormat.k32BitBlockDataFormat:
         case BlockDataFormat.kDoubleBlockDataFormat:
            throw 'kDoubleBlockDataFormat, not supported currently';

         default: {
            this.ringBuffer = new Int16Array(this.ringBufferBuffer);
         }
      }
   }

   //called by Quark to see if data is available
   count(): number {
      return (this.inIndex - this.outIndex) & this.lenMask;

      // let result = this.inIndex - this.outIndex;
      // if (result < 0)
      //    result += this.ringBuffer.length;

      // //Thread safety for case where inIndex has been incremented but not yet wrapped
      // if (result >= this.ringBuffer.length)
      //    result = this.ringBuffer.length - 1;
      // return result;
   }
   freeSpace(): number {
      return this.ringBuffer.length - this.count() - 1;
   }

   writeInt(value: number): boolean {
      return this.writeValue(value);
   }

   writeValue(value: number): boolean {
      if (!this.freeSpace()) return false;
      this.ringBuffer[this.inIndex++] = value;
      if (this.inIndex >= this.ringBuffer.length) this.inIndex = 0;
      return true;
   }

   writeAll(chunk: Int16Array): boolean {
      const space = this.freeSpace();
      if (chunk.length > space) return false;
      const bufLen = this.ringBuffer.length;
      let remaining = chunk.length;
      if (remaining) {
         let copyLen1 = bufLen - this.inIndex;
         if (copyLen1 > remaining) copyLen1 = remaining;
         //copy copyLen1 samples into the buffer starting at the start of the free space in ringBuffer

         //Old node Buffer code
         // const buffer = Buffer.from(chunk.buffer);
         // buffer.copy(
         //    this.ringBufferBuffer,
         //    this.inIndex * kBytesPer16BitSample,
         //    0,
         //    copyLen1 * kBytesPer16BitSample
         // );

         //New ShareArrayBuffer based code
         this.ringBuffer.set(chunk.subarray(0, copyLen1), this.inIndex);

         this.inIndex += copyLen1;
         if (this.inIndex >= bufLen) this.inIndex -= bufLen;
         remaining -= copyLen1;
         if (remaining) {
            //still some left to copy, wrap to start of ringBuffer

            //Old node Buffer code
            // buffer.copy(
            //    this.ringBufferBuffer,
            //    0,
            //    copyLen1,
            //    remaining * kBytesPer16BitSample
            // );

            //New ShareArrayBuffer based code
            this.ringBuffer.set(chunk.subarray(copyLen1), 0);

            this.inIndex += remaining;
            if (this.inIndex >= bufLen) this.inIndex -= bufLen;
         }
      }
      return true;
   }

   //Internal implementation
   ringBuffer: Int16Array | Float32Array; //View onto ringBufferBuffer
   ringBufferBuffer: SharedArrayBuffer; //Buffer; //Memory under ringBuffer (shared with Quark)
   inIndex: number; //read by Quark to see if data is available
   outIndex: number; //written by Quark when data is read from buffer.
}
