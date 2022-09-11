import { UnitPrefix, UnitsInfo } from '../../../public/device-api';
import { calcCRC2, code, nanoWriteMessage, toBytesInt32 } from './utils';

export const deviceName = 'Human NIBP Nano Floating Point';
export const deviceClassId = '927317c6-e601-11ec-8fea-0242ac120002';
//UUID generated using https://www.uuidgenerator.net/version1

// the device supplies in units of beats per ten minutes and deci-mmHg, etc, hence the conversion factor of 10
export const kConversionFactor = 10;
export const kPressureRangeMaxMmHg = 330;
export const kDecimalPlaces = 1;
export const kBPMRangeMax = 200;
export const IBIRangeMax = 2000;
export const kCuffCountRange = 2;
export const kCuffCountDownRange = 4000;
export const kQualRange = 10;
export const kBeatsRange = 40;
export const kSupportedSamplesPerSec = [200];
export const kDefaultSamplesPerSecIndex = 0;
export const kDefaultSamplesPerSec =
   kSupportedSamplesPerSec[kDefaultSamplesPerSecIndex];
export const kDefaultCuffSwitchingInterval = 15;
export const kMinOutBufferLenSamples = 32;
export const kDefaultNumOfChannels = 15;
export const kSTX = 0xd4;
export const kCmdBytePacketOffset = 4;
export const kCRClen = 1;
export const kDataSamplesPerStatusSample = 50;
export const kPhysiocalOffBeats = 4;
export const kWarningAnnotationTimeoutms = 15000;

export enum NanoChannels {
   kBP,
   kBPHC,
   kHGT,
   kSYS,
   kSYSHC,
   kMAP,
   kMAPHC,
   kDIA,
   kDIAHC,
   kHR,
   kIBI,
   kActiveCuff,
   kCuffCountdown,
   kQualLevel,
   kAutoCalCountdown
}

export const kStreamNames = [
   'Finger Pressure',
   'Finger Pressure (HC)',
   'HCU Pressure',
   'Systolic',
   'Systolic (HC)',
   'Mean Arterial',
   'Mean Arterial (HC)',
   'Diastolic',
   'Diastolic (HC)',
   'Heart Rate',
   'Interbeat Interval',
   'Active Cuff',
   'Cuff Countdown',
   'AutoCal Quality',
   'AutoCal Countdown'
];

export enum CuffMode {
   UseCuff1 = 1, // Matches value hardware expects
   UseCuff2 = 2,
   SwitchCuffs = 3
}
export const kCuffIsSwitching = 0x3e;
export type CuffSwitchInterval = 0 | 1 | 15 | 30 | 60 | 0x3f; // 0 = disable, // 0x3f = reset

function switchIntervalCommandFunction(interval: CuffSwitchInterval) {
   const message = new Uint8Array([
      kSTX,
      0x02,
      0x02,
      kSTX,
      0x63,
      (interval << 2) | 0x00, // interval in mins is at bits 2-7
      0
   ]);
   message[6] = calcCRC2(message, 4, 6);
   return message;
}

export enum NanoTestTypes {
   SteadyPressure = 0x01, // Matches the value the hardware expects
   SquareWave = 0x02,
   SimulatePressure = 0x03
}

export enum PhysiocalState {
   kPhysiocalOff = 0x00,
   kPhysiocalOnIdle = 0x01,
   kPhysiocalScan = 0x02,
   kPhysiocalAdjust = 0x03
}

export const NanoTxSampCmds = {
   // [kSTX, cmdWriteLEN, cmdWriteLEN, kSTX, cmdID, [cmd-data], [crc]]
   // crc's have been pre-calculated for all send commands except switchIntervalCommand
   kAlive: new Uint8Array([kSTX, 0x01, 0x01, kSTX, 0x61, 0x3b]),

   switchIntervalCommand: (interval: CuffSwitchInterval) => {
      return switchIntervalCommandFunction(interval);
   },
   resetCuffScheduler: () => {
      return switchIntervalCommandFunction(0x3f);
   },
   kUseCuffOne: nanoWriteMessage([code('c'), CuffMode.UseCuff1]),
   kSwitchCuffs: nanoWriteMessage([code('c'), CuffMode.SwitchCuffs]),

   kHCUZero: new Uint8Array([kSTX, 0x01, 0x01, kSTX, 0x7a, 0x86]),

   kDisablePhysioCal: new Uint8Array([
      kSTX,
      0x02,
      0x02,
      kSTX,
      0x68,
      0x00,
      0x2c
   ]),
   kEnablePhysioCal: new Uint8Array([kSTX, 0x02, 0x02, kSTX, 0x68, 0x01, 0x72]),
   kAskPhysioCalState: new Uint8Array([kSTX, 0x01, 0x01, kSTX, 0x68, 0xa7]),

   kStartMeasure: nanoWriteMessage([code('e'), 0x01]),
   kStopMeasure: nanoWriteMessage([code('e'), 0x02]),

   kEnterTestMode: nanoWriteMessage([code('e'), 0x03]),
   kExitTestMode: nanoWriteMessage([code('e'), 0x04]),

   kClearFirstError: nanoWriteMessage([code('e'), 0x06]),

   startTest: (testType: NanoTestTypes, p0: number, p1: number, p2: number) =>
      nanoWriteMessage([
         code('t'),
         0x01,
         testType,
         ...toBytesInt32(p0),
         ...toBytesInt32(p1),
         ...toBytesInt32(p2)
      ])
};

// Sampling commands structure
export const NanoRxSampCmds = {
   // [kSTX, cmdReadLEN, cmdReadLEN, kSTX, cmdID]
   kBeat2bCmdHead: new Uint8Array([kSTX, 0x0f, 0x0f, kSTX, 0x62]),
   kDataCmdHead: new Uint8Array([kSTX, 0x0a, 0x0a, kSTX, 0x64]),
   kStatusCmdHead: new Uint8Array([kSTX, 0x10, 0x10, kSTX, 0x73]),

   kHardwareInfo: new Uint8Array([
      kSTX,
      0x82,
      0x82,
      kSTX,
      PacketType.VersionInfo,
      VersionPacketType.HardwareInfo
   ]),
   kApplicationVersion: new Uint8Array([
      kSTX,
      0x82,
      0x82,
      kSTX,
      PacketType.VersionInfo,
      VersionPacketType.ApplicationVersion
   ]),
   kBootloaderVersion: new Uint8Array([
      kSTX,
      0x82,
      0x82,
      kSTX,
      PacketType.VersionInfo,
      VersionPacketType.BootloaderVersion
   ])
};

export const enum PacketType {
   VersionInfo = 0x76, // further filterd by VersionPacketType
   Beat2BDataTransmission = 0x62,
   DataTransmission = 0x64,
   Status = 0x73
}

export const enum VersionPacketType {
   HardwareInfo = 0x00,
   ApplicationVersion = 0x0a,
   BootloaderVersion = 0x0b
}

export const kBaseVersionInfo = new Uint8Array([
   kSTX,
   0x82,
   0x82,
   kSTX,
   PacketType.VersionInfo
]);
export const kHardwareInfoCmd = new Uint8Array([
   kSTX,
   0x02,
   0x02,
   kSTX,
   PacketType.VersionInfo,
   VersionPacketType.HardwareInfo,
   0x1c
]);
export const kApplicationVersionCmd = new Uint8Array([
   kSTX,
   0x02,
   0x02,
   kSTX,
   PacketType.VersionInfo,
   VersionPacketType.ApplicationVersion,
   0x62
]);
export const kBootloaderVersionCmd = new Uint8Array([
   kSTX,
   0x02,
   0x02,
   kSTX,
   PacketType.VersionInfo,
   VersionPacketType.BootloaderVersion,
   0x3c
]);

export enum NanoHCUState {
   kHCUNotConnected,
   kHCUNotZeroed,
   kHCUZeroed,
   kHCUZeroUncertain,
   kHCUZeroingNow
}

export enum NanoModes {
   Starting = 0,
   Idle = 1,
   Measure = 3,
   Service = 4,
   Bootloader = 7,
   Error = 15
}

export const PacketLength: Record<PacketType, number> = {
   [PacketType.Beat2BDataTransmission]: kCRClen + 15,
   [PacketType.DataTransmission]: kCRClen + 10,
   [PacketType.Status]: kCRClen + 16,
   [PacketType.VersionInfo]: kCRClen + 130
};

const BloodPressureUnitsInfo = {
   unitName: 'mmHg',
   prefix: UnitPrefix.kNoPrefix,
   defaultDecPlaces: kDecimalPlaces,
   maxInPrefixedUnits: kPressureRangeMaxMmHg,
   maxInADCValues: kPressureRangeMaxMmHg * kConversionFactor,
   minInPrefixedUnits: 0,
   minInADCValues: 0,
   maxValidADCValue: kPressureRangeMaxMmHg * kConversionFactor,
   minValidADCValue: 0
};

export const DefaultUnits: Record<NanoChannels, UnitsInfo> = {
   [NanoChannels.kBP]: BloodPressureUnitsInfo,
   [NanoChannels.kBPHC]: BloodPressureUnitsInfo,
   [NanoChannels.kHGT]: BloodPressureUnitsInfo,
   [NanoChannels.kSYS]: BloodPressureUnitsInfo,
   [NanoChannels.kSYSHC]: BloodPressureUnitsInfo,
   [NanoChannels.kMAP]: BloodPressureUnitsInfo,
   [NanoChannels.kMAPHC]: BloodPressureUnitsInfo,
   [NanoChannels.kDIA]: BloodPressureUnitsInfo,
   [NanoChannels.kDIAHC]: BloodPressureUnitsInfo,

   [NanoChannels.kHR]: {
      unitName: 'bpm',
      prefix: UnitPrefix.kNoPrefix,
      defaultDecPlaces: 0,
      maxInPrefixedUnits: kBPMRangeMax,
      maxInADCValues: kBPMRangeMax * kConversionFactor,
      minInPrefixedUnits: 0,
      minInADCValues: 0,
      maxValidADCValue: kBPMRangeMax * kConversionFactor,
      minValidADCValue: 0
   },
   [NanoChannels.kIBI]: {
      unitName: 's',
      prefix: UnitPrefix.kMilli,
      defaultDecPlaces: 0,
      maxInPrefixedUnits: IBIRangeMax,
      maxInADCValues: IBIRangeMax,
      minInPrefixedUnits: 0,
      minInADCValues: 0,
      maxValidADCValue: IBIRangeMax,
      minValidADCValue: 0
   },
   [NanoChannels.kActiveCuff]: {
      unitName: 'CuffNum',
      prefix: UnitPrefix.kNoPrefix,
      defaultDecPlaces: 0,
      maxInPrefixedUnits: kCuffCountRange,
      maxInADCValues: kCuffCountRange,
      minInPrefixedUnits: 0,
      minInADCValues: 0,
      maxValidADCValue: kCuffCountRange,
      minValidADCValue: 0
   },
   [NanoChannels.kCuffCountdown]: {
      unitName: 'SecondsLeft',
      prefix: UnitPrefix.kNoPrefix,
      defaultDecPlaces: 0,
      maxInPrefixedUnits: kCuffCountDownRange,
      maxInADCValues: kCuffCountDownRange,
      minInPrefixedUnits: 0,
      minInADCValues: 0,
      maxValidADCValue: kCuffCountDownRange,
      minValidADCValue: 0
   },
   [NanoChannels.kQualLevel]: {
      unitName: 'QualLevel',
      prefix: UnitPrefix.kNoPrefix,
      defaultDecPlaces: 0,
      maxInPrefixedUnits: kQualRange,
      maxInADCValues: kQualRange,
      minInPrefixedUnits: 0,
      minInADCValues: 0,
      maxValidADCValue: kQualRange,
      minValidADCValue: 0
   },
   [NanoChannels.kAutoCalCountdown]: {
      unitName: 'BeatsLeft',
      prefix: UnitPrefix.kNoPrefix,
      defaultDecPlaces: 0,
      maxInPrefixedUnits: kBeatsRange,
      maxInADCValues: kBeatsRange,
      minInPrefixedUnits: 0,
      minInADCValues: 0,
      maxValidADCValue: kBeatsRange,
      minValidADCValue: 0
   }
};
