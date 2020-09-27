import { UnitPrefix, IDeviceSetting } from '../../../public/device-api';
import { UnitsInfo16Bit, UnitsInfoImpl } from '../../../public/device-units';

const kDefaultDecimalPlaces = 3;
const kDefaultNumExGSignals = 8;
export const kNumberEnvironmentSignals = 3;

const kNumberGyroSignals = 3;
const kNumberAccSignals = 3;
const kNumberMagSignals = 3;
const kNumberTempSignals = 1;
const kNumberLightSignals = 1;
const kNumberBatterySignals = 1;

export const kNumberOrinSignals =
   kNumberAccSignals + kNumberGyroSignals + kNumberMagSignals;

export const kDefaultSamplesPerSec = 250;
export const kMediumRateSamplesPerSec = 500;
// 1000 Hz is currently experimental (23/9/2020)
// const kHighRateSamplesPerSec = 1000;

export const kOrientationSamplesPerSec = 20;
export const kEnvironmentSamplesPerSec = 1;

/* Setup for 8 channel device */
export const kStreamNames = [
   'EEG1',
   'EEG2',
   'EEG3',
   'EEG4',
   'EEG5',
   'EEG6',
   'EEG7',
   'EEG8',
   'ACC X',
   'ACC Y',
   'ACC Z',
   'GYRO X',
   'GYRO Y',
   'GYRO Z',
   'MAG X',
   'MAG Y',
   'MAG Z',
   'Temp',
   'Light',
   'Battery'
];

/**
 *
 * Implements {IDeviceSetting}
 */
const kDefaultEnabled = {
   settingName: 'Enabled',
   value: true,
   options: [
      { value: true, display: new Boolean(true).toString() },
      { value: false, display: new Boolean(false).toString() }
   ]
};

/**
 *
 * Implements {IDeviceSetting}
 */
const kDefaultDisabled = {
   settingName: 'Disabled',
   value: false,
   options: [
      { value: true, display: new Boolean(true).toString() },
      { value: false, display: new Boolean(false).toString() }
   ]
};

/* 
An Analog to Digital Converter collects raw signals and these must be converted
into scientifically useful units and numbers. This method will make the correct 
conversion. 

It is part of the settings object. It is used per signal in the settings.
*/
const kUnitsForGain1 = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kMilli, //unit prefix
   kDefaultDecimalPlaces,
   400,
   -400
);

const kUnitsForAcc = new UnitsInfo16Bit(
   ' mG', //unit name
   UnitPrefix.kNoPrefix, //unit prefix
   1,
   0x7fff * 0.061, //maxInPrefixedUnits
   -0x7fff * 0.061 //minInPrefixedUnits
);

const kUnitsForGyro = new UnitsInfo16Bit(
   ' mdps', //unit name
   UnitPrefix.kNoPrefix, //unit prefix
   1,
   0x7fff * 8.75, //maxInPrefixedUnits
   -0x7fff * 8.75 //minInPrefixedUnits
);

const kUnitsForMag = new UnitsInfo16Bit(
   ' mGauss', //unit name
   UnitPrefix.kNoPrefix, //unit prefix
   1,
   0x7fff * 1.52, //maxInPrefixedUnits
   -0x7fff * 1.52 //minInPrefixedUnits
);

const kUnitsForTemp = new UnitsInfoImpl(
   ' \u00B0' + 'C',
   UnitPrefix.kNoPrefix,
   1,
   200,
   200,
   -20,
   -20,
   110,
   0
);

const kUnitsForLight = new UnitsInfoImpl(
   ' lux',
   UnitPrefix.kNoPrefix,
   3,
   100000, // Direct sunlight. https://en.wikipedia.org/wiki/Lux
   100000,
   0,
   0,
   100000,
   0
);

const kUnitsForBattery = new UnitsInfoImpl(
   ' %',
   UnitPrefix.kNoPrefix,
   0,
   100,
   100,
   0,
   0,
   100,
   0
);

export function unitsFromPosFullScale(posFullScale: number) {
   switch (posFullScale) {
      case kUnitsForGain1.maxInPrefixedUnits:
         return kUnitsForGain1;
      case kUnitsForAcc.maxInPrefixedUnits:
         return kUnitsForAcc;
      case kUnitsForGyro.maxInPrefixedUnits:
         return kUnitsForGyro;
      case kUnitsForMag.maxInPrefixedUnits:
         return kUnitsForMag;
      case kUnitsForTemp.maxInPrefixedUnits:
         return kUnitsForTemp;
      case kUnitsForLight.maxInPrefixedUnits:
         return kUnitsForLight;
      case kUnitsForBattery.maxInPrefixedUnits:
         return kUnitsForBattery;
   }
   console.warn(
      'Unknown positive full scale value: ' + posFullScale + 'using default'
   );
   return kUnitsForGain1;
}

export function getDefaultDisabledStreamSettings(
   numberOfExGSiganls = kDefaultNumExGSignals
) {
   return getDataInStreams(numberOfExGSiganls, kDefaultDisabled);
}

export function getDefaultSettingsForStream(
   numberOfSignals: number,
   unit: UnitsInfo16Bit,
   rate: IDeviceSetting,
   enabledSetting = kDefaultEnabled
) {
   return [...Array(numberOfSignals)].map(() => {
      return {
         enabled: enabledSetting,
         inputSettings: getInputSettings(unit),
         samplesPerSec: rate
      };
   });
}

export function getDataInStreams(
   numberOfExGSiganls = kDefaultNumExGSignals,
   enabledSetting = kDefaultEnabled
) {
   return [
      ...getDefaultSettingsForStream(
         numberOfExGSiganls,
         kUnitsForGain1,
         kDefaultExGRates,
         enabledSetting
      ),
      ...getDefaultSettingsForStream(
         kNumberAccSignals,
         kUnitsForAcc,
         kDefaultOrientationRate,
         enabledSetting
      ),
      ...getDefaultSettingsForStream(
         kNumberGyroSignals,
         kUnitsForGyro,
         kDefaultOrientationRate,
         enabledSetting
      ),
      ...getDefaultSettingsForStream(
         kNumberMagSignals,
         kUnitsForMag,
         kDefaultOrientationRate,
         enabledSetting
      ),
      ...getDefaultSettingsForStream(
         kNumberTempSignals,
         kUnitsForTemp,
         kDefaultEnvironmentRate,
         enabledSetting
      ),
      ...getDefaultSettingsForStream(
         kNumberLightSignals,
         kUnitsForLight,
         kDefaultEnvironmentRate,
         enabledSetting
      ),
      ...getDefaultSettingsForStream(
         kNumberBatterySignals,
         kUnitsForBattery,
         kDefaultEnvironmentRate,
         enabledSetting
      )
   ];
}

export function getDefaultSettings(numberOfExGSiganls = kDefaultNumExGSignals) {
   const kDefaultSettings = {
      version: 1,
      dataInStreams: getDataInStreams(numberOfExGSiganls)
   };

   return kDefaultSettings;
}

/**
 *
 * Implements {IDeviceInputSettingsSys}
 */
function getInputSettings(unitsInfo: UnitsInfo16Bit) {
   return {
      range: {
         settingName: 'Range',
         value: unitsInfo.maxInPrefixedUnits,
         options: [
            {
               value: unitsInfo.maxInPrefixedUnits,
               display: unitsInfo.rangeDisplayString
            }
         ]
      }
   };
}

/**
 *
 * Implements {IDeviceSetting}
 */
const kDefaultExGRates = {
   settingName: 'Rate',
   value: kDefaultSamplesPerSec,
   options: [
      {
         value: kDefaultSamplesPerSec,
         display: kDefaultSamplesPerSec.toString() + ' Hz'
      },
      {
         value: kMediumRateSamplesPerSec,
         display: kMediumRateSamplesPerSec.toString() + ' Hz'
      }
      // 1000 Hz is currently experimental (23/9/2020)
      // {
      //    value: kHighRateSamplesPerSec,
      //    display: kHighRateSamplesPerSec.toString() + ' Hz'
      // }
   ]
};

const kDefaultOrientationRate = {
   settingName: 'Rate',
   value: kOrientationSamplesPerSec,
   options: [
      {
         value: kOrientationSamplesPerSec,
         display: kOrientationSamplesPerSec + ' Hz'
      }
   ]
};

const kDefaultEnvironmentRate = {
   settingName: 'Rate',
   value: kEnvironmentSamplesPerSec,
   options: [
      {
         value: kEnvironmentSamplesPerSec,
         display: kEnvironmentSamplesPerSec.toString() + ' Hz'
      }
   ]
};
