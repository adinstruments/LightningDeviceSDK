import {
   DeviceProxyId,
   IDeviceManagerApi,
   IDeviceProxyAPI,
   IDeviceSettingsApi
} from '../../../public/device-api';
import {
   IDeviceUIApi,
   IUIAreaApi,
   IUIElementApi
} from '../../../public/device-ui-api';
import { PluginFeatureTypes } from '../../../public/plugin-api';
import { CuffMode, deviceClassId, deviceName } from './constants';
import { NIBPSettings } from './settings';

export class NIBPNanoUI implements IDeviceUIApi {
   name = deviceName + ' UI';
   type: PluginFeatureTypes = 'Device UI';

   // We provide UI for NIBP devices.
   matchesDevice(deviceClassGuid: string, deviceInternalName: string): boolean {
      return deviceClassGuid === deviceClassId;
   }

   // Store the result of the last HCU zero operation so it can be displayed to the
   // user.
   private static lastHcuStatus = '';

   /**
    * Called by Lightning when the user wishes to configure the device.
    *
    * @param deviceSettings Javascript object containing all settings for the
    * device.
    * @param deviceIndex Index of the device within the recording (i.e. will be
    * 0 for the first device or if it is the only device used in the recording).
    * @param deviceManager Provides access to the recording's device management
    * interface.
    */
   describeDeviceSettingsUI(
      deviceSettings: IDeviceSettingsApi,
      deviceId: DeviceProxyId,
      deviceManager: IDeviceManagerApi,
      deviceProxy?: IDeviceProxyAPI
   ): IUIAreaApi {
      const elements: IUIElementApi[] = [];

      const settings = deviceSettings as NIBPSettings;
      const { isSampling } = deviceManager;

      elements.push({
         type: 'device-name',
         title: 'Configure NIBP Device'
      });

      elements.push({
         type: 'header',
         title: 'Sampling setup'
      });

      elements.push({
         type: 'action',
         label: 'Height correction',
         buttonText: 'Zero',
         actionInProgressText: 'Zeroing',
         calcDisabled: () => isSampling,
         action: (callback) => {
            // Let the UI know we've started a time-consuming action.
            callback &&
               callback({
                  type: 'started',
                  options: 'default'
               });

            // Make the process take a wee bit of time so the user feels the button click
            // actually did something.
            setTimeout(() => {
               if (deviceProxy) {
                  //use IDeviceProxyAPI instead of IDeviceManagerApi.
                  deviceProxy
                     .callFunction('hcuZero', JSON.stringify({}))
                     .then((result) => {
                        if (result) {
                           NIBPNanoUI.lastHcuStatus = result.hcuStatus;
                        }
                     })
                     .catch((error) => {
                        NIBPNanoUI.lastHcuStatus = 'HCU zero failed';
                        console.error('HCU zero failed: ' + error);
                     })
                     .finally(() => {
                        // We've finished, tell Lightning to re-enable other UI elements.
                        callback &&
                           callback({
                              type: 'finished',
                              options: 'refresh all'
                           });
                     });
               } else {
                  setTimeout(
                     () =>
                        callback &&
                        callback({
                           type: 'failed',
                           message:
                              'Zeroing failed for an unknown reason. Please try again.'
                        }),
                     2000
                  );
               }
            }, 1000);
         }
      });

      //The lastHcuStatus is retreived after first HCU zero callback
      if (NIBPNanoUI.lastHcuStatus) {
         elements.push({
            type: 'message',
            label: '',
            text: NIBPNanoUI.lastHcuStatus
         });
      }

      elements.push({
         type: 'setting',
         setting: settings.autoCalibrate,
         controlType: 'toggle',
         info:
            'Auto-calibration improves accuracy in the arterial blood pressure measurement by providing an ongoing calibration, approximately every 70 beats during longer recordings and more often in the first few minutes of recording.\n\nIt is recommended to enable this setting unless the subject is moving around considerably during recording.',
         disabled: false
      });

      elements.push({
         type: 'setting',
         setting: settings.cuffMode,
         controlType: 'list',
         disabled: false
      });

      const cuffSwitchingEnabled =
         settings.cuffMode.value === CuffMode.SwitchCuffs;

      if (cuffSwitchingEnabled) {
         elements.push({
            type: 'setting',
            setting: settings.cuffSwitchingInterval,
            controlType: 'list',
            disabled: false
         });

         elements.push({
            type: 'action',
            buttonText: 'Switch now',
            disabled: !isSampling,
            action: (callback) => {
               // Let the UI know we've started a time-consuming action.
               callback &&
                  callback({
                     type: 'started',
                     options: 'default'
                  });

               // Make the process take a wee bit of time so the user feels the button click
               // actually did something.
               setTimeout(() => {
                  if (deviceProxy) {
                     //use IDeviceProxyAPI instead of IDeviceManagerApi.
                     deviceProxy
                        .callFunction('switchNow', JSON.stringify({}))
                        .finally(() => {
                           // We've finished, tell Lightning to re-enable other UI elements.
                           callback &&
                              callback({
                                 type: 'finished',
                                 options: 'refresh all'
                              });
                        });
                  }
               }, 200);
            }
         });
      }

      elements.push({
         type: 'setting',
         setting: settings.continueOnError,
         controlType: 'toggle',
         info:
            'Continue recording if the hNIBP nano errors, select this option if you have other devices recording in the same document and wish to keep recording from them.',
         disabled: false
      });

      return {
         elements,
         layout: 'default',
         desiredWidthPixels: 420,
         desiredHeightPixels: 280
      };
   }
}
