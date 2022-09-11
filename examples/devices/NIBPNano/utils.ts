import { BlockDataFormat, UnitPrefix } from '../../../public/device-api';
import { UnitsInfoImpl } from '../../../public/device-units';
import {
   kCRClen,
   kSTX,
   kSupportedSamplesPerSec,
   NanoChannels,
   VersionPacketType,
   kBaseVersionInfo,
   DefaultUnits
} from './constants';

export function findClosestSupportedRateIndex(samplesPerSec: number) {
   const result = kSupportedSamplesPerSec.findIndex(
      (value) => value <= samplesPerSec
   );

   if (result < 0) return kSupportedSamplesPerSec.length - 1;

   return result;
}

export function findClosestSupportedRate(samplesPerSec: number) {
   return kSupportedSamplesPerSec[findClosestSupportedRateIndex(samplesPerSec)];
}

/**
 * Calculates CRC for the payload of the Nano messages
 * CRC-8 Dallas/Maxim - x^8 + x^5 + x^4 + x^1
 */
export function CheckCRC(payload: any, payloadCrc: any) {
   let calcdCrc = 0;

   for (let chrCount = 0; chrCount < payload.length; chrCount++) {
      let chr = payload[chrCount];

      for (let bitCount = 0; bitCount < 8; bitCount++) {
         const mix = (chr ^ calcdCrc) & 0x01;

         calcdCrc >>= 1;
         chr >>= 1;

         if (mix) calcdCrc ^= 0x8c;
      }
   }

   return payloadCrc == calcdCrc;
}

export function findVersionInfoData(
   byteArray: Buffer,
   scanPos: number,
   packetType: VersionPacketType
) {
   let versionStruct: Buffer = Buffer.alloc(0);
   const versionCmd = kBaseVersionInfo;
   const vcmdPos = scanPos;

   if (byteArray[vcmdPos + 1] == packetType)
      if (vcmdPos + versionCmd[1] + kCRClen < byteArray.length) {
         versionStruct = byteArray.slice(vcmdPos + 2, vcmdPos + versionCmd[1]);
      }

   return versionStruct;
}

export function parseAndLogHardwareInfo(byteArray: Buffer) {
   const hwVersionBuffer = byteArray.slice(0x08, 0x08 + 2);
   const hwVersion = (hwVersionBuffer[1] << 8) | hwVersionBuffer[0];
   console.log('Hw Version: ' + hwVersion);

   const hwModelBuffer = byteArray.slice(0x0a, 0x0a + 2);
   const hwModel = (hwModelBuffer[1] << 8) | hwModelBuffer[0];
   switch (hwModel) {
      case 0x00:
         console.log(
            'Hw Model: Undefined (shall be handled as Nano Core Nova)'
         );
         break;
      case 0x01:
         console.log('Hw Model: Nano Core Nova');
         break;
      case 0x02:
         console.log('Hw Model: Nano Core OEM');
         break;
   }

   const serialNumber = byteArray.slice(0x1c, 0x1c + 100); // can be up to 100 bytes
   console.log('Serial No. ' + serialNumber);
   return { serialNumber: serialNumber.toString(), hwVersion };
}

export function parseAndLogVersionStruct(byteArray: Buffer) {
   const major = byteArray.slice(0x0a, 0x0a + 0x01);
   const minor = byteArray.slice(0x0b, 0x0b + 0x01);
   const patchBuffer = byteArray.slice(0x0c, 0x0c + 0x02);
   const patch = (patchBuffer[1] << 8) | patchBuffer[0];
   console.log('v' + major[0] + '.' + minor[0] + '.' + patch);

   const protocolVersion = byteArray.slice(0x10, 0x10 + 0x01);
   console.log('Protocol Version: ' + protocolVersion[0]);
}

export function getDataFormat() {
   return BlockDataFormat.k16BitBlockDataFormat;
}

export function getDefaultUnits(channelIndex: NanoChannels) {
   if (channelIndex > NanoChannels.kAutoCalCountdown) {
      return new UnitsInfoImpl(
         'V', //unit name
         UnitPrefix.kNoPrefix, //unit prefix
         2, //defaultDecPlaces
         32768, //maxInPrefixedUnits - determines the displayed range in gain/rate settings
         32768, //maxInADCValues
         0, //minInPrefixedUnits
         0, //minInADCValues
         32678, //maxValidADCValue - affects the default drag scale range max
         0 //minValidADCValue - affects the default drag scale range min
      );
   }

   return UnitsInfoImpl.createFromUnitsInfo(DefaultUnits[channelIndex]);
}

/**
 * CRC-8 Dallas/Maxim - x^8 + x^5 + x^4 + x^1
 * @param payload
 * @returns
 */
export function calcCRC(payload: number[]) {
   return calcCRC2(new Uint8Array(payload), 0, payload.length);
}

/**
 * Formats a write command ready to be sent to the device.
 *
 * @param cmdData The message payload data. See the accompanying NIBP protocol
 * firmware documentation:
 *
 * PRD1002-4-123_IDD Nano Core Communication Protocol Firmware v2.0.0.1678_1.0.pdf
 */
export function nanoWriteMessage(cmdData: number[]) {
   const cmdWriteLen = cmdData.length;
   const crc = calcCRC(cmdData);

   // [kSTX, cmdWriteLEN, cmdWriteLEN, kSTX, cmdID, [cmd-data], [crc]]
   return new Uint8Array([
      kSTX,
      cmdWriteLen,
      cmdWriteLen,
      kSTX,
      ...cmdData,
      crc
   ]);
}

export function code(char: string) {
   return char.charCodeAt(0);
}

export function toBytesInt32(i32: number) {
   const arr = new ArrayBuffer(4); // an Int32 takes 4 bytes
   const view = new DataView(arr);
   view.setUint32(0, i32, false); // byteOffset = 0; litteEndian = false
   return new Uint8Array(arr);
}

/**
 * CRC-8 Dallas/Maxim - x^8 + x^5 + x^4 + x^1
 * @param payload
 * @param start
 * @param end
 * @returns
 */
export function calcCRC2(payload: Uint8Array, start: number, end: number) {
   let crc = 0 | 0;

   for (let chrCount = start; chrCount < end; ++chrCount) {
      let chr = payload[chrCount];

      for (let bitCount = 0; bitCount < 8; ++bitCount) {
         const mix = (chr ^ crc) & 1;
         crc >>= 1;
         chr >>= 1;
         if (mix) crc ^= 0x8c;
      }
   }

   return crc;
}
