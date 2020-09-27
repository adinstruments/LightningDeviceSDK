import { StreamRingBuffer } from './device-api'; //'libs/quark-sys';

const kBytesPer16BitSample = 2;

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
      bytesPerSample = 2
   ) {
      this.indexInDevice = indexInDevice;
      this.inIndex = 0;
      this.outIndex = 0;

      //let buffer = Buffer.alloc(sizeInSamples*2);
      //let buffer = new ArrayBuffer(412);

      const sizePow2 = this.calcPow2n(minSizeInSamples);
      this.lenMask = sizePow2 - 1;

      const sizeBytes = sizePow2 * bytesPerSample;

      //Potential crashes in v8 heap when using node.Buffer to share memory with Quark
      //from web workers!
      //this.ringBufferBuffer = Buffer.allocUnsafe(sizeBytes);

      const sharedBuffer = new SharedArrayBuffer(sizeBytes);
      this.ringBufferBuffer = sharedBuffer;

      //ringBufferBuffer shares ringBuffer's memory
      this.ringBuffer = new Int16Array(this.ringBufferBuffer);
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
   ringBuffer: Int16Array; //View onto ringBufferBuffer
   ringBufferBuffer: SharedArrayBuffer; //Buffer; //Memory under ringBuffer (shared with Quark)
   inIndex: number; //read by Quark to see if data is available
   outIndex: number; //written by Quark when data is read from buffer.
}
