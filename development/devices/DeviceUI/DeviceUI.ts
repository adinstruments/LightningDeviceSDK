import { IDeviceProxyAPI } from 'public/device-api';
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
   deviceClassName = 'SerialSettings';

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
      deviceManager: IDeviceManagerApi,
      deviceProxy?: IDeviceProxyAPI
   ): IUIAreaApi {
      const out: IUIElementApi[] = [];

      out.push({
         type: 'header',
         title: 'SerialSettings Device',
         subtitle: `${deviceManager.deviceDisplayName(
            deviceIndex
         )}, ${settings.streamName || 'Input'}`
      });

      out.push({
         type: 'setting',
         setting: settings.samplesPerSec,
         controlType: 'rate-list',
         disabled: !deviceManager.multiRate,
         info: deviceManager.multiRate
            ? undefined
            : 'Setting a different rate for just this signal requires enabling Multi Rate in Recording Sampling Settings'
      });

      out.push({
         type: 'setting',
         controlType: 'list',
         setting: settings.inputSettings.range
      });

      const desiredWidthPixels = 650;
      const desiredHeightPixels = 400;

      out.push({
         type: 'signal-preview'
      });

      return {
         elements: out,
         layout: 'default',
         desiredWidthPixels,
         desiredHeightPixels
      };
   }
}

module.exports = {
   getDeviceUIClasses() {
      return [new DeviceUI()];
   }
};
