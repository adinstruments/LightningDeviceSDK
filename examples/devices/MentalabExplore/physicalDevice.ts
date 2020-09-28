import {
   OpenPhysicalDevice,
   DuplexDeviceConnection,
   OpenPhysicalDeviceDescriptor
} from '../../../public/device-api';
import { DeviceClass } from './deviceClass';
import { kEnableLogging } from './enableLogging';
import { Parser } from './parser';
import { kNumberOrinSignals, kNumberEnvironmentSignals } from './settings';

/**
 * PhysicalDevice is a representation of the connected hardware device
 *
 * Must implement OpenPhysicalDevice in libs/quark-sys
 */
export class PhysicalDevice implements OpenPhysicalDevice {
   deviceName: string;
   typeName: string;
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

      this.typeName = 'v' + String(this.parser.firmwareVersion);

      // friendlyName looks like Explore_CA4B, we'll take the C4AB
      const friendlyName: string = this.deviceConnection.friendlyName;
      if (friendlyName.length > 2)
         this.serialNumber = friendlyName.split('_')[1];

      this.numberOfChannels =
         this.parser.numberExgSignals +
         kNumberOrinSignals +
         kNumberEnvironmentSignals;

      this.deviceName = 'Mentalab Explore' + ' ' + this.typeName;
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

   getDescriptor(): OpenPhysicalDeviceDescriptor {
      return {
         deviceType: this.getDeviceName(),
         numInputs: this.getNumberOfAnalogInputs(),
         deviceId: this.serialNumber || this.deviceConnection.devicePath
      };
   }
}
