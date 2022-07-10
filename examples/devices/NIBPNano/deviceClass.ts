import {
   DuplexDeviceConnection,
   IDeviceClass,
   ProxyDeviceSys,
   TDeviceConnectionType
} from '../../../public/device-api';
import { DuplexStream } from '../../../public/device-streams';
import {
   deviceName,
   deviceClassId,
   kHardwareInfoCmd,
   kApplicationVersionCmd,
   kBootloaderVersionCmd,
   VersionPacketType
} from './constants';
import { NanoParser } from './nanoParser';
import { PhysicalDevice } from './physicalDevice';
import { ProxyDevice } from './proxy';
import { parseAndLogHardwareInfo, parseAndLogVersionStruct } from './utils';
import { DeviceClassBase } from '../../../public/device-class-base';
import { debugLog } from './enableLogging';

/**
 * The device class is the set of types of device that can share the same settings so that
 * when a recording is re-opened, Quark will try to match device proxies read from disk to
 * available physical devices on a "best fit" match of capabilies.
 * The DeviceClass object represents this set of devices and can find and create PhysicalDevice
 * objects of its class, as well as the ProxyDevice objects.
 */
export class DeviceClass extends DeviceClassBase implements IDeviceClass {
   constructor() {
      super();
      this.checkDeviceIsPresent = this.checkDeviceIsPresent.bind(this);
   }

   onError(err: Error) {
      console.error(err);
   }

   /**
    * Called when the app shuts down. Chance to release any resources acquired during this object's
    * life.
    */
   release() {}

   /**
    * @returns the name of the class of devices
    */
   getDeviceClassName() {
      return 'HumanNIBPNano';
   }

   /**
    * @returns a GUID to identify this object
    */
   getClassId() {
      return deviceClassId;
   }

   /**
    * @returns a TDeviceConnectionType that defines the connection type.
    * ie. USB, serial etc.
    */
   getDeviceConnectionType() {
      return TDeviceConnectionType.kDevConTypeSerialPort;
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
      callback: (error: Error | null, device: PhysicalDevice | null) => void
   ) {
      debugLog(deviceName + ' Checking');
      debugLog(deviceConnection);

      if (
         deviceConnection.vendorId !== '0403' ||
         deviceConnection.productId !== '6001' ||
         deviceConnection.manufacturer !== 'FTDI'
      ) {
         debugLog(deviceName + ' Rejecting');

         callback(null, null); // Did not find one of our devices on this connection
         return;
      }

      if (deviceConnection.pnpId.includes('ADICODA')) {
         debugLog('NIBPnano: bailing to stop clobbering CODA connection...');
         callback(null, null);
         return;
      }

      debugLog(deviceName + ' Accepting');

      deviceConnection.setOption({ baud_rate: 115200 });
      const devStream = new DuplexStream(deviceConnection);
      //node streams default to 'utf8' encoding, which most devices won't understand.
      //With 'utf8' encoding, non-ascii chars, such as:
      //could be expanded into multiple bytes, so we use 'binary' instead.
      devStream.setDefaultEncoding('binary');

      const kDeviceDetectionTimeoutMs = 60000;
      // Give up if device is not detected within the timeout period
      const deviceTimeout = global.setTimeout(() => {
         devStream.destroyConnection(); // stop 'data' and 'error' callbacks
         const err = new Error(
            `Timed out: Human NIBP Nano did not respond to version request.`
         );
         console.warn(err);
         callback(err, null);
      }, kDeviceDetectionTimeoutMs);

      let physicalDeviceCreated = false;

      let hwInfo = {
         serialNumber: '',
         hwVersion: 0
      };

      let versionStep:
         | 'hardware info'
         | 'application version'
         | 'bootloader version' = 'hardware info';

      const onPacketFound = (
         packetType: VersionPacketType,
         newBytes: Buffer
      ) => {
         switch (packetType) {
            case VersionPacketType.HardwareInfo: {
               debugLog('--- HardwareInfo ---');
               hwInfo = parseAndLogHardwareInfo(newBytes);
               versionStep = 'application version';
               devStream.write(kApplicationVersionCmd);
               break;
            }
            case VersionPacketType.ApplicationVersion:
               debugLog('--- ApplicationVersion ---');
               parseAndLogVersionStruct(newBytes);

               if (versionStep !== 'application version') {
                  // We might not have HWInfo
                  // versionCommandTimeout will send the right command
                  return;
               }

               versionStep = 'bootloader version';
               devStream.write(kBootloaderVersionCmd);
               break;

            case VersionPacketType.BootloaderVersion:
               debugLog('--- BootloaderVersion ---');
               parseAndLogVersionStruct(newBytes);

               if (versionStep !== 'bootloader version') {
                  // We might not have HWInfo or App Version
                  // versionCommandTimeout will send the right command
                  return;
               }

               global.clearInterval(versionCommandTimeout);

               if (!physicalDeviceCreated) {
                  packetParser.setProxyDevice(null);
                  const physicalDevice = new PhysicalDevice(
                     this,
                     deviceConnection,
                     packetParser,
                     hwInfo.serialNumber,
                     hwInfo.hwVersion
                  );

                  physicalDeviceCreated = true;
                  global.clearTimeout(deviceTimeout);
                  callback(null, physicalDevice);
               }
               break;
         }
      };

      // Parser will callback if device info packet is returned
      // Temporary proxy device is passed into the parser.
      const packetParser = new NanoParser(
         devStream,
         {
            outStreamBuffers: [],
            onSamplingStarted: () => {},
            onSamplingStopped: () => {},
            onSamplingUpdate: () => {},
            onPacket: onPacketFound,
            //This onError() handler will be replaced by the
            //PhysicalDevice when it is created
            onError: (err: Error) => {
               global.clearInterval(versionCommandTimeout);
               global.clearTimeout(deviceTimeout);
               console.log(err); // errors include timeouts
               devStream.destroyConnection(); // stop 'data' and 'error' callbacks
               callback(err, null);
            }
         },
         deviceName
      );

      const versionCommandTimeout = setInterval(() => {
         let command = kHardwareInfoCmd;
         switch (versionStep) {
            case 'hardware info':
               command = kHardwareInfoCmd;
               break;
            case 'application version':
               command = kApplicationVersionCmd;
               break;
            case 'bootloader version':
               command = kBootloaderVersionCmd;
               break;

            default:
               command = kHardwareInfoCmd;
         }

         devStream.write(command);
      }, 500);
      return;
   }

   /**
    * @param quarkProxy the Quark component of the ProxyDevice - used for notifying Quark of events
    * @param physicalDevice the instance of your implementation of PhysicalDevice
    * @returns a ProxyDevice
    */
   createProxyDevice(
      quarkProxy: ProxyDeviceSys | null,
      physicalDevice: PhysicalDevice | null
   ) {
      return new ProxyDevice(quarkProxy, physicalDevice);
   }
}
