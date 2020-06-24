import {
   IDeviceUIApi,
   IDeviceStreamApi,
   IDeviceManagerApi,
   IUIAreaApi,
   IUIElementApi
} from '../../public/device-api';
import { PluginFeatureTypes } from '../../public/plugin-api';

export class DeviceUI implements IDeviceUIApi {
   name = 'SerialSettings UI';
   type: PluginFeatureTypes = 'Device UI';
   matchesDevice(deviceDisplayName: string) {
      return deviceDisplayName === 'SerialSettings';
   }

   /**
    * Defines the user interface elements that will be used to adjust basic rate / range settings
    * for this device.
    *
    * @param streamSettings settings for the current stream within the recording.
    * @param deviceIndex 0-based index of the stream's device within the recording.
    * @param deviceManager Reference to the current device manager.
    */
   describeStreamSettingsUI(
      settings: IDeviceStreamApi,
      deviceIndex: number,
      deviceManager: IDeviceManagerApi
   ): IUIAreaApi {
      const elements: IUIElementApi[] = [];

      elements.push({
         type: 'header',
         title: 'SerialSettings Device',
         subtitle: `${deviceManager.deviceDisplayName(
            deviceIndex
         )}, ${settings.streamName || 'Input'}`
      });

      elements.push({
         type: 'setting',
         setting: settings.samplesPerSec,
         controlType: 'rate-list',
         disabled: !deviceManager.multiRate,
         info: deviceManager.multiRate
            ? undefined
            : 'Setting a different rate for just this signal requires enabling Multi Rate in Recording Sampling Settings'
      });

      elements.push({
         type: 'setting',
         controlType: 'list',
         setting: settings.inputSettings.range
      });

      elements.push({
         type: 'signal-preview'
      });

      return {
         elements,
         layout: 'default',
         desiredWidthPixels: 650,
         desiredHeightPixels: 400
      };
   }
}

module.exports = {
   getDeviceUIClasses() {
      return [new DeviceUI()];
   }
};
