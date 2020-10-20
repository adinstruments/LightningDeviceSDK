export const kTestOpenDeviceClassName = 'MentalabExplore';
export const kDeviceClassId = '98c7a612-37eb-11ea-aec2-2e728ce11111';
// UUID generated using https://www.uuidgenerator.net/version1
// This must be unique for this device class.

/* 
0xDEADBEAF is the only fixed part of the packet, and its at the end.
 We assume this 'fletcher' (packet tail), which is from a previous packet 
 is the header (so that we can find a new packet). This further assumes that no garbage data ever appears after a fletcher
 */
const kHeaderWithPayloadLength = 4;

// Packet ID byte
// '<int> | 0' tells JS this is an integer
export const enum PacketType {
   kNotFound = 0 | 0,
   kORN = 13 | 0,
   kENV = 19 | 0,
   kTime = 27 | 0,
   kEEG99 = 62 | 0,
   kDeviceInfo = 99 | 0,
   kDisconnnect = 111 | 0,
   kEEG94 = 144 | 0,
   kEEG98 = 146 | 0,
   kCommand2Byte = 160 | 0,
   kCommand4Byte = 176 | 0,
   kAck = 192 | 0,
   kCommandStatus = 193 | 0,
   kMarker = 194 | 0,
   kCalibration = 195 | 0,
   kEEG94R = 208 | 0,
   kEEG98R = 210 | 0
}

export const enum PayloadLengthBytes {
   kDeviceInfo = 12 | 0,
   kCommandAcknowledge = 13 | 0, // doc incorrectly says 14 bytes;
   // 8 Channel sample data: (8+ (1+number of active channels)*3*16)
   kEEG98 = 440 | 0,
   // 4 Channel sample data: (8+ (1+number of active channels)*3*33)
   kEEG94 = 503 | 0,
   kORN = 26 | 0,
   kEnv = 13 | 0,
   kCommandStatus = 14 | 0,
   kMarker = 9 | 0
}

// Actual sample data length (exlcude 8 bytes from PayloadLengthBytes)
export const enum SampleLengthBytes {
   kEEG98 = 432 | 0,
   kEEG94 = 495 | 0,
   kORN = 18 | 0,
   kEnv = 5 | 0,
   kCommandStatus = 6 | 0
}

export const kMaxSizePacketType = PacketType.kEEG94;

export function packetTypeToSize(type: PacketType) {
   switch (type) {
      case PacketType.kDeviceInfo:
         return kHeaderWithPayloadLength + PayloadLengthBytes.kDeviceInfo;
      case PacketType.kAck:
         return (
            kHeaderWithPayloadLength + PayloadLengthBytes.kCommandAcknowledge
         );
      case PacketType.kCommandStatus:
         return kHeaderWithPayloadLength + PayloadLengthBytes.kCommandStatus;
      case PacketType.kENV:
         return kHeaderWithPayloadLength + PayloadLengthBytes.kEnv;
      case PacketType.kMarker:
         return kHeaderWithPayloadLength + PayloadLengthBytes.kMarker;
      case PacketType.kEEG98:
      case PacketType.kEEG98R:
         return kHeaderWithPayloadLength + PayloadLengthBytes.kEEG98;
      case PacketType.kEEG94:
      case PacketType.kEEG94R:
         return kHeaderWithPayloadLength + PayloadLengthBytes.kEEG94;
      case PacketType.kORN:
         return kHeaderWithPayloadLength + PayloadLengthBytes.kORN;
      default:
         console.warn('Unknown Packet type:', type);
   }
   return 0;
}
