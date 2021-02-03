import {
   OpenPhysicalDevice,
   OpenPhysicalDeviceDescriptor,
   IDeviceClass,
   IDuplexStream
} from './device-api';
import { Parser } from './packet-parser';

/**
 * PhysicalDevice is a representation of the connected hardware device.
 * Other than constants, we should generally access the PhysicalDevice
 * via the ProxyDevice.
 */
export class PhysicalDevice implements OpenPhysicalDevice {
   deviceName: string;
   serialNumber: string;
   deviceStream: IDuplexStream;
   parser: Parser;
   numberOfChannels: number;

   constructor(
      private deviceClass: IDeviceClass,
      deviceStream: IDuplexStream,
      friendlyName: string,
      versionInfo: string,
      numberOfChannels: number
   ) {
      this.numberOfChannels = numberOfChannels;
      this.deviceStream = deviceStream;
      this.serialNumber = JSON.parse(versionInfo).serialNumber;

      this.parser = new Parser(deviceStream, this.numberOfChannels);
      this.deviceName = deviceClass.getDeviceClassName() + ': ' + friendlyName;
   }

   getDeviceName() {
      return this.deviceName;
   }

   getNumberOfAnalogInputs() {
      return this.numberOfChannels;
   }

   getNumberOfAnalogStreams() {
      return this.numberOfChannels;
   }

   getDescriptor(): OpenPhysicalDeviceDescriptor {
      return {
         deviceType: this.deviceClass.getDeviceClassName(),
         numInputs: this.getNumberOfAnalogInputs(),
         deviceId: this.serialNumber || this.deviceStream.source.devicePath
      };
   }
}
