import {
   OpenPhysicalDevice,
   DuplexDeviceConnection,
   OpenPhysicalDeviceDescriptor
} from '../../../public/device-api';
import { DeviceClass } from './deviceClass';
import { kEnableLogging } from './enableLogging';
import { Parser } from './parser';
import { kNumberOfOrientationSignals, kNumberEnvironmentSignals } from './settings';

/**
 * PhysicalDevice is a representation of the connected hardware device
 *
 * Must implement OpenPhysicalDevice in libs/quark-sys
 */
export class PhysicalDevice implements OpenPhysicalDevice {
   deviceName: string;
   typeName: string;
   firmwareVersion: string;
   deviceConnection: DuplexDeviceConnection;
   parser: Parser;
   numberOfChannels: number;
   serialNumber = '';

   constructor(
      private deviceClass: DeviceClass,
      deviceConnection: DuplexDeviceConnection,
      parser: Parser
   ) {
      this.deviceConnection = deviceConnection;
      this.parser = parser;

      console.log('device connection', deviceConnection);

      this.firmwareVersion = 'v' + String(this.parser.firmwareVersion);

      // friendlyName looks like Explore_CA4B, we'll take the C4AB
      const friendlyName: string = this.deviceConnection.friendlyName;
      this.typeName = friendlyName;
      if (friendlyName.length > 2) {
         const parts = friendlyName.split('_');
         this.typeName = parts[0];
         this.serialNumber = parts[1];
      }

      this.numberOfChannels =
         this.numberOfEXGStreams() +
         kNumberOfOrientationSignals +
         kNumberEnvironmentSignals;

      this.deviceName = 'Mentalab Explore' + ' (' + this.firmwareVersion + ')';
      if (kEnableLogging) console.log('Physical device:', this);
   }

   release() {
      if (kEnableLogging) console.log('Physical Device Release');
      if (this.deviceConnection) {
         this.deviceConnection.onStreamDestroy();
         this.deviceConnection.release();
      }
   }

   onError = (err: Error) => {
      console.log('Physical Device Error');
      console.warn(err);
   };

   /**
    * @returns the name of the device
    */
   getDeviceName() {
      return this.deviceName;
   }

   /**
    * @returns number of analog inputs on this device
    */
   getNumberOfAnalogInputs() {
      return this.numberOfChannels;
   }

   /**
    * @returns number of analog output streams on this device
    */
   getNumberOfAnalogStreams() {
      return this.numberOfChannels;
   }

   numberOfEXGStreams(): number {
      return this.parser.numberExgSignals;
   }


   getDescriptor(): OpenPhysicalDeviceDescriptor {
      return {
         deviceType: this.typeName,
         numInputs: this.getNumberOfAnalogInputs(),
         deviceId: this.serialNumber || this.deviceConnection.devicePath
      };
   }

}
