import {
   IDeviceUIApi,
   IDeviceStreamApi,
   IDeviceManagerApi,
   IUIAreaApi,
   IUIElementApi
} from '../../public/device-api';
import { PluginFeatureTypes } from '../../public/plugin-api';

class SerialWithMappedInputsUI implements IDeviceUIApi {
   type: PluginFeatureTypes = 'Device UI';
   name = 'SerialWithMappedInputsUI';

   matchesDevice(
      deviceDisplayName: string,
      deviceInternalName: string
   ): boolean {
      return deviceDisplayName.startsWith('SerialWithMappedInputs');
   }

   describeStreamSettingsUI(
      settings: IDeviceStreamApi,
      deviceIndex: number,
      deviceManager: IDeviceManagerApi
   ): IUIAreaApi {
      const out: IUIElementApi[] = [];

      out.push({
         type: 'header',
         title: 'Sampling settings',
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

      if (settings.inputId) {
         out.push({
            type: 'setting',
            setting: settings.inputId,
            controlType: 'searchable-list',
            info: 'Choose input to stream from the device'
         });
      }

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
      return [new SerialWithMappedInputsUI()];
   }
};
