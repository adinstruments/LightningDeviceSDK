import {
   IDeviceClass,
   TDeviceConnectionType,
   DuplexDeviceConnection,
   OpenPhysicalDevice,
   OpenPhysicalDeviceDescriptor,
   ProxyDeviceSys
} from '../../../public/device-api';
import { DuplexStream } from '../../../public/device-streams';
import { kEnableLogging } from './enableLogging';
import { CommandPacketOp, Parser } from './parser';
import { PhysicalDevice } from './physicalDevice';
import { ProxyDevice } from './proxy';
import { kDeviceClassId, kTestOpenDeviceClassName, PacketType } from './utils';

/**
 * The device class is the set of types of device (eg Mentalab or Powerlab) that
 * can share the same settings so that when a recording is re-opened, Quark
 * will try to match device proxies read from disk to available physical devices
 * on a "best fit" match of capabilies.
 *
 * The DeviceClass object represents this set of devices and can find and create
 * PhysicalDevice objects of its class, as well as the ProxyDevice objects.
 */
export class DeviceClass implements IDeviceClass {
   constructor() { }

   onError(err: Error) {
      console.error(err);
   }

   /**
    * Called when the app shuts down. Chance to release any resources acquired
    *  during this object's life.
    */
   release() { }

   /**
    * @returns the name of the class of devices, must be one word with no spaces, or use quotes.
    */
   getDeviceClassName(): string {
      return kTestOpenDeviceClassName;
   }

   /**
    * @returns a GUID to identify this object
    */
   getClassId() {
      return kDeviceClassId;
   }

   /**
    * @returns {TDeviceConnectionType} that defines the connection type.
    * ie. USB, serial etc.
    */
   getDeviceConnectionType() {
      return TDeviceConnectionType.kDevConTypeSerialOverBluetooth;
   }

   /**
    * This is called by Lightning when enumerating connections while searching for devices.
    *
    * @param deviceConnection An object which contains information about the connection,
    * and allows communication with the device.
    *
    * @param callback When finished, callback must be called with the PhysicalDevice object if
    * successfully identified. Any errors are passed through as well.
    */
   checkDeviceIsPresent(
      deviceConnection: DuplexDeviceConnection,
      callback: (error: Error | null, device: OpenPhysicalDevice | null) => void
   ) {
      if (kEnableLogging) {
         console.log('Mentalab Checking');
         console.log(deviceConnection);
      }

      const expectedFriendlyName = 'Explore_';

      // This is a bit weak right now as the MentaLab device
      // doesn't have a vendor or productID.
      const deviceMatch =
         deviceConnection.friendlyName &&
         deviceConnection.friendlyName.includes(expectedFriendlyName);

      if (!deviceMatch) {
         if (kEnableLogging) console.log('Mentalab Rejecting');
         callback(null, null); // Did not find one of our devices on this connection
         return;
      }
      if (kEnableLogging) console.log('Mentalab Accepting');

      const devStream = new DuplexStream(deviceConnection);

      //node streams default to 'utf8' encoding, which most devices won't understand.
      //With 'utf8' encoding, non-ascii chars, such as:
      //could be expanded into multiple bytes, so we use 'binary' instead.
      devStream.setDefaultEncoding('binary');

      const kDeviceDetectionTimeoutMs = 25000;
      // Give up if device is not detected within the timeout period
      const deviceTimeout = global.setTimeout(() => {
         devStream.destroyConnection(); // stop 'data' and 'error' callbacks
         const err = new Error(
            `Timed out: MentaLab Exlpore did not respond to version request.`
         );
         console.warn(err);
         callback(err, null);
      }, kDeviceDetectionTimeoutMs);

      let deviceInfoFound = false;
      let physicalDeviceCreated = false;

      const onPacketFound = (packetType: PacketType, buffer: unknown) => {
         if (packetType === PacketType.kDeviceInfo && !deviceInfoFound) {
            console.log('Device info packet found');
            deviceInfoFound = true;

            packetParser.sendCommand(CommandPacketOp.setSampleRate, 1);
            packetParser.sendCommand(CommandPacketOp.setChannelMask, 0xff);
         }
         if (
            packetType === PacketType.kCommandStatus &&
            !physicalDeviceCreated
         ) {
            //Make sure the dummy datasink will no longer be called since we don't stream errors to
            //cause callback() to be called again!
            packetParser.setProxyDevice(null);
            const physicalDevice = new PhysicalDevice(
               this,
               deviceConnection,
               packetParser
            );

            physicalDeviceCreated = true;
            global.clearTimeout(deviceTimeout);
            callback(null, physicalDevice); // End of good scenario
         }
      };
      // Parser will callback if device info packet is returned
      // Temporary proxy device is passed into the parser.
      const packetParser = new Parser(devStream, {
         outStreamBuffers: [],
         onSamplingStarted: () => { },
         onSamplingStopped: () => { },
         onSamplingUpdate: () => { },
         onPacket: onPacketFound,
         //This onError() handler will be replaced by the
         onError: (err: Error) => {
            global.clearTimeout(deviceTimeout);
            if (kEnableLogging) console.log('Error connecting');
            console.log(err); // errors include timeouts
            devStream.destroyConnection(); // stop 'data' and 'error' callbacks
            callback(err, null);
         }
      });
      return;
   }

   indexOfBestMatchingDevice(
      descriptor: OpenPhysicalDeviceDescriptor,
      availablePhysDevices: OpenPhysicalDeviceDescriptor[]
   ): number {
      //Find devices of the same type
      const sameType = availablePhysDevices.filter((it) => it.deviceType === descriptor.deviceType);

      //First check for exact match
      const index = sameType.findIndex(it => it.deviceId === descriptor.deviceId);
      if (index !== -1)
         return index;

      //Find device of same type (if possible) with closest number of inputs
      const available = sameType.length ? sameType : availablePhysDevices;
      const deltaNInputs = available.map((it, index) => { return { diff: descriptor.numInputs - it.numInputs, index }; });
      deltaNInputs.sort((l, r) => Math.abs(l.diff - r.diff));
      return deltaNInputs.length ? deltaNInputs[0].index : -1;
   }

   /**
    * @param {ProxyDeviceSys | null} quarkProxy the Quark component of the ProxyDevice - used for notifying Quark of events
    * @param { PhysicalDevice | null} physicalDevice the instance of your implementation of PhysicalDevice
    * @returns a ProxyDevice
    */
   createProxyDevice(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: PhysicalDevice | null
   ) {
      return new ProxyDevice(quarkProxy, physicalDevice);
   }
}
