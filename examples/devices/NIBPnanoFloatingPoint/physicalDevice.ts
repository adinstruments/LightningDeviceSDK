import {
   DuplexDeviceConnection,
   OpenPhysicalDevice,
   OpenPhysicalDeviceDescriptor
} from '../../../public/device-api';
import { DeviceClass } from './deviceClass';
import { NanoParser } from './nanoParser';
import { NanoChannels } from './constants';

const kNIBPPhysicalDeviceName = 'Human NIBP Nano Floating Point';
/**
 * PhysicalDevice is a representation of the connected hardware device
 */
export class PhysicalDevice implements OpenPhysicalDevice {
   deviceClass: DeviceClass;
   deviceName: string;
   deviceConnection: DuplexDeviceConnection;
   numberOfChannels: number;
   parser: NanoParser;
   serialNumber = '';

   constructor(
      deviceClass: DeviceClass,
      deviceConnection: DuplexDeviceConnection,
      parser: NanoParser,
      serialNumber: string,
      hwVersion: number
   ) {
      this.deviceClass = deviceClass;
      this.deviceConnection = deviceConnection;
      this.numberOfChannels = Object.keys(NanoChannels).length / 2;
      this.onError = this.onError.bind(this);
      this.parser = parser;
      this.serialNumber = serialNumber;

      this.deviceName = kNIBPPhysicalDeviceName;
   }

   release() {
      if (this.deviceConnection) {
         this.deviceConnection.onStreamDestroy();
         this.deviceConnection.release();
      }
   }

   onError(err: Error) {
      console.error(err);
   }

   /**
    * @returns the name of this particular device
    */
   getDeviceName() {
      return this.deviceName;
   }

   /**
    * @returns number of inputs on this device
    */
   getNumberOfAnalogInputs() {
      return this.numberOfChannels;
   }

   /**
    * @returns number of output streams on this device
    */
   getNumberOfAnalogStreams() {
      return this.numberOfChannels;
   }

   getDescriptor(): OpenPhysicalDeviceDescriptor {
      return {
         deviceType: this.deviceClass.getDeviceClassName(),
         numInputs: this.getNumberOfAnalogInputs(),
         deviceId: this.serialNumber || this.deviceConnection.devicePath
      };
   }
}
