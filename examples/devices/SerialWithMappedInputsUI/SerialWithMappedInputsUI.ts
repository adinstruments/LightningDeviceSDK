import {
   IDeviceUIApi,
   IDeviceStreamApi,
   IDeviceManagerApi,
   IUIAreaApi,
   IUIElementApi,
   DeviceProxyId
} from '../../../public/device-api';
import { PluginFeatureTypes } from '../../../public/plugin-api';

/**
 * Expose a class that LabChart Lightning will use when evaluating what
 * User Interface to present to the user when configuring devices of this
 * type.
 *
 * Similar to SerialSettingsUI, adding an element for choosing which input
 * to record from.
 */
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
      deviceId: DeviceProxyId,
      deviceManager: IDeviceManagerApi
   ): IUIAreaApi {
      // UI elements that will be shown in the signal sampling settings UI.
      // Returned from this function.
      const elements: IUIElementApi[] = [];

      // Add a title describing the device being configured and subtitle with the
      // name of the current stream.
      elements.push({
         type: 'header',
         title: 'SerialWithMappedInputs Device',
         subtitle: `${deviceManager.deviceDisplayName(
            deviceId
         )}, ${settings.streamName || 'Input'}`
      });

      // Add a dropdown list allowing user to choose a supported rate.
      elements.push({
         type: 'setting',
         setting: settings.samplesPerSec,
         controlType: 'rate-list',
         // Disable the dropdown if recording is in single-rate mode (the default).
         disabled: !deviceManager.multiRate,
         // Optional information tooltip displayed next to dropdown when the
         // recording is in single-rate mode to explain why the element is disabled.
         info: deviceManager.multiRate
            ? undefined
            : 'Setting a different rate for just this signal requires enabling Multi Rate in Recording Sampling Settings'
      });

      // Add a list element for selecting the stream's input gain.
      elements.push({
         type: 'setting',
         controlType: 'list',
         setting: settings.inputSettings.range
      });

      if (settings.inputId) {
         elements.push({
            type: 'setting',
            setting: settings.inputId,
            controlType: 'searchable-list',
            info: 'Choose input to stream from the device'
         });
      }

      const desiredWidthPixels = 650;
      const desiredHeightPixels = 400;

      // Include a live sampling preview of the signal with settings applied.
      elements.push({
         type: 'signal-preview'
      });

      return {
         elements,
         layout: 'default',
         desiredWidthPixels,
         desiredHeightPixels
      };
   }
}

module.exports = {
   // Function that Lightning looks for within our exports and invokes on
   // application startup.
   getDeviceUIClasses() {
      return [new SerialWithMappedInputsUI()];
   }
};
