import { DuplexDeviceConnection, IDuplexStream } from './device-api';

type ErrorListener = (err: Error) => {};
type DataListener = (chunk: Int8Array | null) => {};
type DestroyListener = (error: Error | null) => void;

type EmitFunc = (event: string | symbol, ...args: any[]) => boolean;

export class DuplexStream implements IDuplexStream {
   //extends Duplex implements IDuplexStream {
   source: DuplexDeviceConnection;
   isRunning: boolean;
   lastErr: Error | null;
   timeoutms: number;
   timer?: NodeJS.Timeout;

   onError: ErrorListener;
   onData: DataListener;
   onDestroy = (error: Error | null) => {}; //DestroyListener

   defaultWriteCallback = (error: Error | null | undefined) => {
      return;
   };

   //on(event: "error", listener: (err: Error) => void): this;
   //on(event: string | symbol, listener: (...args: any[]) => void): this;

   //These were inherited from Duplex (when running in the main thread and using node streams)

   on(event: string | symbol, listener: (...args: any[]) => void) {
      if (event === 'error') {
         this.onError = listener as ErrorListener;
      } else if (event === 'data') {
         this.onData = listener as DataListener;
         if (!this.isRunning) {
            //The client is now interested in receiving data. Open the HW connection.
            this.isRunning = this.source.start();
         }
      }
   }

   emit(event: string | symbol, ...args: any[]): boolean {
      if (event === 'error') {
         this.onError(new Error(args[0]));
         return true;
      }
      return false;
   }

   setDefaultEncoding(encoding: string) {
      //we want binary by default
      if (encoding !== 'binary') {
         throw Error('DuplexStream currently only implements binary encoding');
      }
      return this;
   }

   destroy(error?: Error): void {
      this._destroy(error, this.onDestroy);
   }

   //destroy both the stream and the underlying HW connection
   destroyConnection(): void {
      this.destroy();
      this.source.release();
   }

   write(
      chunk: any,
      encoding?: BufferEncoding,
      cb?: (error: Error | null | undefined) => void
   ): boolean {
      this._write(chunk, encoding, cb ? cb : this.defaultWriteCallback);
      return true;
   }

   private _readHandler = (
      error: Error | null,
      chunk: Int8Array | null
   ): void => {
      if (error) {
         this.lastErr = error;
         this.isRunning = false;
         this.onError(error);
      }
      // if (chunk && !this.push(chunk)) {
      //    this.source.stop();
      //    this.isRunning = false;
      // }
      if (chunk && this.onData) {
         this.onData(chunk);
         //this.source.stop();
         //this.isRunning = false;
      }
      if (this.timer !== undefined) {
         clearTimeout(this.timer);
         if (chunk && this.timeoutms > 0)
            //Retrigger timer
            this.timer = setTimeout(this.onTimeout, this.timeoutms);
      }
   };

   private onTimeout = () => {
      process.nextTick(() => {
         this.emit('error', 'Timed out');
      });
   };

   constructor(source: DuplexDeviceConnection /*, options?: DuplexOptions*/) {
      //super(options);
      this.source = source;
      this.lastErr = null;
      this.timeoutms = 0;
      this.isRunning = false;
      this.source.setReadHandler(this._readHandler);
   }

   //Generate a timeout error if no data is returned from a read within the
   //timeout period.
   setReadTimeout(ms: number) {
      this.timeoutms = ms;
      if (this.timeoutms > 0 && this.timer === undefined)
         this.timer = setTimeout(this.onTimeout, this.timeoutms);
   }

   clearReadTimeout() {
      if (this.timer) {
         this.timeoutms = 0; //disable future timeouts
         clearTimeout(this.timer);
      }
   }

   _read(size: number) {
      if (this.lastErr) {
         process.nextTick(() => {
            this.emit('error', this.lastErr);
            this.lastErr = null;
         });
      }
      if (!this.isRunning) {
         this.isRunning = this.source.start();
      }
   }

   _write(
      chunk: string | Buffer,
      encoding: BufferEncoding | undefined,
      callback: (error: Error | null | undefined) => void
   ): void {
      if (!this.isRunning) {
         this.isRunning = this.source.start();
      }
      if (typeof chunk === 'string') {
         this.source.write(
            Buffer.from(chunk as string, encoding ? encoding : 'binary'),
            callback
         );
      } else {
         this.source.write(chunk as Buffer, callback);
      }
   }

   _destroy(
      err: Error | undefined,
      callback: (error: Error | null) => void
   ): void {
      //We want to avoid destroying the Quark IOpenDeviceConnectionCpp object
      //so we can create streams from the connection multiple times.
      //Therefore we call stop() not release().
      this.isRunning = false;
      if (this.timer !== undefined) {
         clearTimeout(this.timer);
         this.timer = undefined;
      }
      this.source.onStreamDestroy();
   }
}

interface Constructor<T> {
   new (...args: any[]): T;
}

export function concatTypedArrays(a: Buffer, b: Buffer, aStartInd: number) {
   // a, b TypedArray of same type
   const c = new (a.constructor as Constructor<Buffer>)(
      a.length + b.length - aStartInd
   );
   const aSub = a.slice(aStartInd, a.length);
   c.set(aSub, aStartInd);
   c.set(b, a.length - aStartInd);
   return c;
}
