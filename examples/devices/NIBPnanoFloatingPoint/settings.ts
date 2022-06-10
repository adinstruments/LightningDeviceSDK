import {
   DeviceValueType,
   IDeviceInputSettingsSys,
   IDeviceProxySettingsSys,
   IDeviceSetting,
   IDeviceStreamApi,
   IDeviceStreamApiImpl,
   UnitsInfo
} from '../../../public/device-api';
import { Setting } from '../../../public/device-settings';
import {
   CuffMode,
   CuffSwitchInterval,
   kDefaultCuffSwitchingInterval,
   kDefaultSamplesPerSecIndex,
   kStreamNames,
   kSupportedSamplesPerSec,
   NanoChannels
} from './constants';
import { NanoParser } from './nanoParser';
import { ProxyDevice } from './proxy';
import { getDataFormat, getDefaultUnits } from './utils';

export interface INIBPSettings extends IDeviceProxySettingsSys {
   autoCalibrate: Setting;
   cuffMode: Setting;
   cuffSwitchingInterval: Setting;
   continueOnError: Setting;
}

export class StreamSettings implements IDeviceStreamApiImpl {
   enabled: any;
   samplesPerSec: any;
   streamName: string;
   inputSettings: InputSettings;

   get isEnabled() {
      return !!this.enabled.value;
   }

   set isEnabled(enabled: boolean) {
      this.enabled.value = enabled;
   }

   setValues(other: IDeviceStreamApi) {
      this.enabled.setValue(other.enabled);
      this.samplesPerSec.setValue(other.samplesPerSec);
      this.inputSettings.setValues(other.inputSettings);
   }

   constructor(
      proxy: ProxyDevice,
      streamIndex: number,
      inputIndex: number,
      settingsData: IDeviceStreamApi
   ) {
      this.streamName = kStreamNames[streamIndex];
      this.enabled = new Setting(
         settingsData.enabled,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            return newValue;
         }
      );

      this.samplesPerSec = new Setting(
         settingsData.samplesPerSec,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(streamIndex, this, {});
            return newValue;
         }
      );
      this.inputSettings = new InputSettings(
         proxy,
         streamIndex,
         inputIndex,
         this,
         settingsData.inputSettings
      );
   }
}

export class NIBPSettings implements INIBPSettings {
   private static kSettingsVersion = 1;

   version = NIBPSettings.kSettingsVersion;
   dataInStreams: IDeviceStreamApi[] = [];

   autoCalibrate: Setting;
   cuffMode: Setting;
   cuffSwitchingInterval: Setting;
   continueOnError: Setting;

   assign(settingsData: NIBPSettings) {
      this.autoCalibrate.setValue(settingsData.autoCalibrate);
      this.cuffMode.setValue(settingsData.cuffMode);
      this.cuffSwitchingInterval.setValue(settingsData.cuffSwitchingInterval);
      this.continueOnError.setValue(settingsData.continueOnError);
   }

   sendToHardware() {
      this.autoCalibrate.sendToHardware();

      switch (this.cuffMode.asNumber) {
         case CuffMode.UseCuff1:
         case CuffMode.UseCuff2:
            this.cuffMode.sendToHardware();
            break;
         default:
            this.cuffSwitchingInterval.sendToHardware();
            break;
      }

      this.continueOnError.sendToHardware();
   }

   // Called when a physical device becomes available for use in the recording.
   onPhysicalDeviceConnected(parser: NanoParser) {
      this.sendToHardware();
   }

   private static defaultEnabled = {
      settingName: 'Enabled',
      value: true,
      options: [
         {
            value: true,
            display: new Boolean(true).toString()
         },
         {
            value: false,
            display: new Boolean(false).toString()
         }
      ]
   };

   private static defaultRate = {
      settingName: 'Rate',
      value: kSupportedSamplesPerSec[kDefaultSamplesPerSecIndex],
      options: [
         {
            value: kSupportedSamplesPerSec[0],
            display: kSupportedSamplesPerSec[0].toString() + ' Hz'
         }
      ]
   };

   private static defaultInputSettings = (index: number) => {
      const defaultUnits = getDefaultUnits(index);
      const defaultRange = defaultUnits.maxInPrefixedUnits;
      return {
         range: {
            settingName: 'Range',
            value: defaultRange,
            options: [
               {
                  value: defaultRange,
                  display: defaultRange.toString() + ' ' + defaultUnits.unitName
               }
            ]
         }
      };
   };

   protected constructor(proxy: ProxyDevice) {
      this.dataInStreams = Object.keys(NanoChannels).map((key, index) => ({
         enabled: NIBPSettings.defaultEnabled,
         samplesPerSec: NIBPSettings.defaultRate,
         inputSettings: NIBPSettings.defaultInputSettings(index)
      }));

      this.autoCalibrate = new Setting(
         {
            options: [],
            settingName: 'Auto calibration',
            value: true
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            if (proxy.parser) {
               proxy.parser.setAutocalibrationEnabled(!!newValue);
            }

            return newValue;
         }
      );

      this.cuffMode = new Setting(
         {
            settingName: 'Cuff-mode',
            value: CuffMode.UseCuff1,
            options: [
               {
                  value: CuffMode.UseCuff1,
                  display: 'Cuff 1 (C1)'
               },
               {
                  value: CuffMode.SwitchCuffs,
                  display: 'Switch cuffs'
               }
            ]
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            if (proxy.parser) {
               proxy.parser.setCuffMode(newValue as CuffMode);
            }

            return newValue;
         }
      );

      this.cuffSwitchingInterval = new Setting(
         {
            settingName: 'Switching interval',
            value: kDefaultCuffSwitchingInterval,
            options: [
               {
                  value: 1,
                  display: '1 minute'
               },
               {
                  value: 15,
                  display: '15 minutes'
               },
               {
                  value: 30,
                  display: '30 minutes'
               },
               {
                  value: 60,
                  display: '1 hour'
               }
            ]
         },
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            if (proxy.parser) {
               proxy.parser.setCuffSwitchInterval(
                  newValue as CuffSwitchInterval
               );
            }

            return newValue;
         }
      );

      this.continueOnError = new Setting(
         {
            options: [],
            settingName: 'Continue On Error',
            value: false
         },
         (
            setting: IDeviceSetting,
            newValue: DeviceValueType
         ): DeviceValueType => {
            if (proxy.parser) {
               proxy.parser.setContinueOnError(!!newValue);
            }

            return newValue;
         }
      );
   }

   static defaults(proxy: ProxyDevice): NIBPSettings {
      return new NIBPSettings(proxy);
   }
}

export class InputSettings {
   unitsInfo: UnitsInfo;
   range: any;

   setValues(other: IDeviceInputSettingsSys) {
      this.range.setValue(other.range);
   }

   constructor(
      proxy: ProxyDevice,
      streamIndex: number,
      inputIndex: number,
      streamSettings: StreamSettings,
      settingsData: IDeviceInputSettingsSys
   ) {
      this.unitsInfo = getDefaultUnits(streamIndex);

      //Gain range setting
      this.range = new Setting(
         settingsData.range,
         (setting: IDeviceSetting, newValue: DeviceValueType) => {
            proxy.updateStreamSettings(streamIndex, streamSettings, {
               unitsInfo: getDefaultUnits(inputIndex)
            });

            return newValue;
         }
      );
   }
}

export class DeviceStreamConfigurationImpl {
   dataFormat: number;
   unitsInfo: UnitsInfo;

   constructor(streamIndex: number) {
      this.dataFormat = getDataFormat();
      this.unitsInfo = getDefaultUnits(streamIndex);
   }
}
