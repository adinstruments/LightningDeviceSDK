import { IDeviceClass, OpenPhysicalDeviceDescriptor } from './device-api';

export class DeviceClassBase
   implements Pick<IDeviceClass, 'indexOfBestMatchingDevice'> {
   indexOfBestMatchingDevice(
      descriptor: OpenPhysicalDeviceDescriptor,
      availablePhysDevices: OpenPhysicalDeviceDescriptor[]
   ): number {
      if (!availablePhysDevices.length) return -1;

      //Find devices of the same type
      const sameType = availablePhysDevices.filter(
         (it) => it.deviceType === descriptor.deviceType
      );

      //First check for exact match
      const deviceWithSameId = sameType.find(
         (it) => it.deviceId === descriptor.deviceId
      );
      if (deviceWithSameId) {
         return availablePhysDevices.indexOf(deviceWithSameId);
      }

      //Find device of same type (if possible) with closest number of inputs
      const available = sameType.length ? sameType : availablePhysDevices;
      const deltaNInputs = available.map((it, index) => {
         return { diff: descriptor.numInputs - it.numInputs, it };
      });
      deltaNInputs.sort((l, r) => Math.abs(l.diff) - Math.abs(r.diff));

      const bestMatch = deltaNInputs[0].it;
      return availablePhysDevices.indexOf(bestMatch);
   }
}
