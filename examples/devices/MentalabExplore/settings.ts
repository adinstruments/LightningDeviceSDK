import {
   UnitPrefix,
   IDeviceSetting,
   IDeviceProxySettingsSys,
   IDeviceStreamApi,
   IProxyDevice,
   DeviceValueType,
   IDeviceStreamConfiguration
} from '../../../public/device-api';
import { UnitsInfo16Bit, UnitsInfoImpl } from '../../../public/device-units';
import { Setting } from '../../../public/device-settings';

export interface IProxyDeviceImpl extends IProxyDevice {
   settings: DeviceSettings;

   /**
    * This is an implementation method, not directly called by Quark. Exposed
    * here so that the DeviceSettings can call it on their ProxyDevice.
    * This updates the quark settings. ProxyDeviceSys is the connection to the
    * proxy device in Quark.
    *
    * Quark will then calls the function returned by applyStreamSettingsToHW,
    * which will send the same settings to the hardware
    *
    * @param {number} streamIndex
    * @param {StreamSettings} streamSettings
    * @param {Partial<IDeviceStreamConfiguration>} config
    * @param {boolean} restartAnySampling
    */
   updateStreamSettings(
      streamIndex: number,
      streamSettings: IDeviceStreamApi | undefined,
      config: Partial<IDeviceStreamConfiguration>,
      restartAnySampling: boolean
   ): void;
}

const kSettingsVersion = 1;

const kDefaultDecimalPlaces = 3;
export const kDefaultNumExGSignals = 8;
export const kNumberEnvironmentSignals = 3;

const kNumberGyroSignals = 3;
const kNumberAccSignals = 3;
const kNumberMagSignals = 3;
const kNumberTempSignals = 1;
const kNumberLightSignals = 1;
const kNumberBatterySignals = 1;

export const kNumberOfOrientationSignals =
   kNumberAccSignals + kNumberGyroSignals + kNumberMagSignals;

//Stream index value that means the setting is the same across
//all EXGStreams, e.g. for this device, the sample rate.
export const kAllEXGStreams = -1;

// 1000 Hz is currently experimental (23/9/2020)
export const kSupportedEXGSamplesPerSec = [/*1000,*/ 500, 250];

export const kDefaultEXGSamplesPerSecIndex = 1; //250 Hz
export const kDefaultEXGSamplesPerSec =
   kSupportedEXGSamplesPerSec[kDefaultEXGSamplesPerSecIndex];

export function findClosestSupportedRateIndex(samplesPerSec: number) {
   //Assumes kSupportedEXGSamplesPerSec is in descending order. If there is no exact match
   //use the closest rate < samplesPerSec.
   const result = kSupportedEXGSamplesPerSec.findIndex(
      (value) => value <= samplesPerSec
   );
   if (result < 0) {
      return kSupportedEXGSamplesPerSec.length - 1;
   }
   return result;
}

export function findClosestSupportedRate(samplesPerSec: number) {
   return kSupportedEXGSamplesPerSec[
      findClosestSupportedRateIndex(samplesPerSec)
   ];
}

export const kOrientationSamplesPerSec = 20;
export const kEnvironmentSamplesPerSec = 1;

export const kNumberOfOtherSignals =
   kNumberOfOrientationSignals + kNumberEnvironmentSignals;

/* Setup for 8 channel device */
export const kEEGStreamNames = [
   'EEG1',
   'EEG2',
   'EEG3',
   'EEG4',
   'EEG5',
   'EEG6',
   'EEG7',
   'EEG8'
];

export const kOtherStreamNames = [
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

export function getStreamName(signalIndex: number, totalNumberOfStreams = 20) {
   const numberOfExGSiganls = totalNumberOfStreams - kOtherStreamNames.length;
   if (signalIndex < numberOfExGSiganls) {
      return kEEGStreamNames[signalIndex];
   }

   return kOtherStreamNames[signalIndex - numberOfExGSiganls];
}

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

const kUnitsForGain2 = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kMilli, //unit prefix
   kDefaultDecimalPlaces,
   100,
   -100
);

const kUnitsForGain3 = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kMilli, //unit prefix
   kDefaultDecimalPlaces,
   50,
   -50
);

const kUnitsForGain4 = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kMicro, //unit prefix
   kDefaultDecimalPlaces,
   25000,
   -25000
);

const kUnitsForGain5 = new UnitsInfo16Bit(
   'V', //unit name
   UnitPrefix.kMicro, //unit prefix
   kDefaultDecimalPlaces,
   12500,
   -12500
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
   255, //Max in prefixed units
   0xff, //Max ADC
   0, //Min in prefixed units.
   0, //Min in ADC value.
   255, //110, //Max valid
   0 //Min valid
);

const kUnitsForLight = new UnitsInfoImpl(
   ' lux',
   UnitPrefix.kNoPrefix,
   3,
   1000, //100000, Max in prefixed units. Direct sunlight is 100000. https://en.wikipedia.org/wiki/Lux
   0x0fff, // Max in ADC values
   0, //Min in prefixed units.
   0, //Min in ADC value.
   0x0fff, //100000,  //Max valid
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
      case kUnitsForGain2.maxInPrefixedUnits:
         return kUnitsForGain2;
      case kUnitsForGain3.maxInPrefixedUnits:
         return kUnitsForGain3;
      case kUnitsForGain4.maxInPrefixedUnits:
         return kUnitsForGain4;
      case kUnitsForGain5.maxInPrefixedUnits:
         return kUnitsForGain5;
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

export class DeviceSettings implements IDeviceProxySettingsSys {
   version = kSettingsVersion;

   //This device's streams all sample at the same rate
   deviceSamplesPerSec: Setting;

   numberExgSignals: number;

   dataInStreams: IDeviceStreamApi[];

   constructor(proxy: IProxyDeviceImpl, nEXGStreams: number) {
      //This device's streams all sample at the same rate
      this.numberExgSignals = nEXGStreams;

      this.deviceSamplesPerSec = new Setting(
         kDefaultExGRates,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(kAllEXGStreams, undefined, {}, true);
            return newValue;
         }
      );

      this.dataInStreams = getDataInStreams(this, this.numberExgSignals);
   }
}

export function getDefaultDisabledStreamSettings(
   deviceSettings: DeviceSettings,
   numberOfExGSignals = kDefaultNumExGSignals
) {
   return getDataInStreams(
      deviceSettings,
      numberOfExGSignals,
      kDefaultDisabled
   );
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
   deviceSettings: DeviceSettings,
   numberOfExGSiganls = kDefaultNumExGSignals,
   enabledSetting = kDefaultEnabled
) {
   return [
      ...getDefaultSettingsForStream(
         numberOfExGSiganls,
         kUnitsForGain1,
         deviceSettings.deviceSamplesPerSec,
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

export function getDefaultSettings(
   proxy: IProxyDeviceImpl,
   numberOfExGSignals = kDefaultNumExGSignals
) {
   const kDefaultSettings = new DeviceSettings(proxy, numberOfExGSignals);

   return kDefaultSettings;

   // const kDefaultSettings = {
   //    version: 1,
   //    dataInStreams: getDataInStreams(proxy.settings, numberOfExGSignals)
   // };

   // return kDefaultSettings;
}

/**
 *
 * Implements {IDeviceInputSettingsSys}
 */
function getInputSettings(unitsInfo: UnitsInfo16Bit) {
   if (unitsInfo.maxInPrefixedUnits === kUnitsForGain1.maxInPrefixedUnits) {
      return {
         range: {
            settingName: 'Range',
            value: kUnitsForGain1.maxInPrefixedUnits,
            options: [
               {
                  value: kUnitsForGain1.maxInPrefixedUnits,
                  display: kUnitsForGain1.rangeDisplayString
               },
               {
                  value: kUnitsForGain2.maxInPrefixedUnits,
                  display: kUnitsForGain2.rangeDisplayString
               },
               {
                  value: kUnitsForGain3.maxInPrefixedUnits,
                  display: kUnitsForGain3.rangeDisplayString
               },
               {
                  value: kUnitsForGain4.maxInPrefixedUnits,
                  display: kUnitsForGain4.rangeDisplayString
               },
               {
                  value: kUnitsForGain5.maxInPrefixedUnits,
                  display: kUnitsForGain5.rangeDisplayString
               }
            ]
         }
      };
   }

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
   value: kDefaultEXGSamplesPerSec,
   options: [
      {
         value: kSupportedEXGSamplesPerSec[0],
         display: kSupportedEXGSamplesPerSec[0].toString() + ' Hz'
      },
      {
         value: kSupportedEXGSamplesPerSec[1],
         display: kSupportedEXGSamplesPerSec[1].toString() + ' Hz'
      }
      // 1000 Hz is currently experimental (23/9/2020)
      // {
      //    value: kSupportedEXGSamplesPerSec[2],
      //    display: kSupportedEXGSamplesPerSec[2].toString() + ' Hz'
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
