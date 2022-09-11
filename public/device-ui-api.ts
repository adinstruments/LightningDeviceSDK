/**
 * @author Peter Suggate
 *
 * API for defining custom User Interface elements to control setting up a hardware device.
 */

import 'react';
import {
   IDeviceStreamApi,
   DeviceValueType,
   IDeviceSetting,
   DeviceInputActionTypes,
   DeviceInputStatusTypes,
   IDeviceManagerApi,
   IDeviceSettingsApi,
   HierarchyOfDeviceSettingsBase,
   DeviceProxyId,
   IDeviceProxyAPI
} from './device-api';
import { IPluginModuleFeature, ILcModel } from './plugin-api';

export type DeviceUIElementTypes =
   | 'setting' // Persisted in settings. The most common element.
   | 'adjustable-value' // Non-persisted control over a hardware option.
   | 'read-only-value'
   | 'device-name'
   | 'header'
   | 'message'
   | 'action'
   | 'multi-step-action'
   | 'custom'
   | 'signal-preview';

export interface IDeviceUIElementBase {
   /**
    * Every UI element specifies a type which tells the app what other
    * information to expect.
    */
   type: DeviceUIElementTypes;

   /**
    * An optional function any element can implement if their inclusion in the
    * UI depends on the state of other settings.
    *
    * This is the way to provide a "dynamic" User Interface such as allowing
    * new elements to appear based on the state of other elements or the
    * device state.
    *
    * @returns true if element is to be shown, false otherwise.
    *
    * Note: show() will be called each time the view re-renders. To trigger this
    * to happen in response to a setting change, specify refreshUIOnChange
    * for a setting's options. See IDeviceUISettingOptions
    *
    * Originally added to allow showing hiding BioAmp DC offset and zero
    * elements conditioned on High pass being set to DC.
    */
   show?: (settings: IDeviceStreamApi) => boolean;

   /**
    * This is a chance for elements to perform initialization immediately prior
    * to any sampling starting in the UI.
    */
   onWillEnterDeviceUI?(): void;

   /**
    * If true, disabled shows the element as non-interactive and prevents the user
    * making changes to the control if applicable.
    */
   disabled?: boolean;

   /** For child/dependent components we want to indent to create visual heirachy */
   indentLevel?: IndentLevel;
}

export type DeviceUIControlTypes =
   | 'default'
   | 'rate-list'
   | 'searchable-list'
   | 'list'
   | 'toggle'
   | 'radio'
   | 'numeric';

export interface IDeviceUISettingRadioOption {
   label: string;
   value: DeviceValueType;
}

export interface IDeviceUISettingOptions {
   /**
    * @property refreshUIOnChange If true, the device UI (including all
    * elements) will be refreshed after a setting has changed. This allows
    * co-dependent parameters to update correctly.
    */
   refreshUIOnChange?: boolean;
}

export type IndentLevel = 0 | 1 | 2 | 3;

export interface IDeviceUISetting extends IDeviceUIElementBase {
   /**
    * Setting for this UI element. The setting will have been created earlier with the device
    * proxy.
    */
   setting: IDeviceSetting;

   /**
    * Indicates to the application how the setting should be interacted with by the
    * user. If not specified, uses 'default' which tries to display the most
    * sensible control type for the data (e.g. checkbox if boolean or list if multiple
    * options are present, etc).
    */
   controlType?: DeviceUIControlTypes;

   /**
    * An optional info message associated with the setting. For example, if
    * setting a rate on the stream is disallowed because the recording is in single-rate mode,
    * error could display explanation to the user.
    */
   info?: string;

   /**
    * Optional adaptors that convert between internal representation and a
    * value the User Interface understands.
    */

   valueToChecked?(value: string | number | boolean | undefined): boolean;
   checkedToValue?(checked: boolean): string | number | boolean;

   /**
    * If controlType is 'radio', this is a list of possible radio options.
    */
   radioOptions?: IDeviceUISettingRadioOption[];

   settingOptions?: IDeviceUISettingOptions;
}

export interface IDeviceUIReadOnlyItem extends IDeviceUIElementBase {
   label: string;
   value?: string;

   /**
    * If defined, the initial status will be obtained from Quark on first
    * render of the UI.
    */
   retrieveValueFromHardware?: () => string;
}

export interface IDeviceUIAdjustableValueRange {
   min: number;
   max: number;
   increment?: number;
}

export interface IDeviceUIAdjustableValue extends IDeviceUIElementBase {
   label: string;

   range?: IDeviceUIAdjustableValueRange;

   /**
    * Optional default value, excluding any suffix. If not provided, the UI
    * element will display as blank until the hardware has been queried for its
    * value for the first time.
    */
   defaultValue?: number;

   /**
    * Optional suffix to be displayed alongside values in the number input.
    *
    * E.g. ' %'
    */
   suffix?: string;

   onChange(newValue: DeviceValueType): Promise<void>;

   latestValueFromHardware?: string;

   /**
    * Implement this if the value can change in response to other actions (e.g.
    * zeroing) occurring.
    */
   refreshLatestValueFromHardware?(): void;
}

export interface IDeviceUIHeader extends IDeviceUIElementBase {
   title: string;
   subtitle?: string;
}

export interface IDeviceUIMessage extends IDeviceUIElementBase {
   text: string;
   label?: string;
}

export type DeviceActionStatusOptions =
   /**
    * @enum default leaves the state of UI elements alone, does not change
    * enabled states of controls.
    */
   | 'default'
   /**
    * @enum disable all instructs Lightning to disable all UI elements on
    * the page because an uninterruptible action is in progress.
    *
    * Make sure to invoke the callback with @enum refresh all before the
    * action completes or else the UI will be left in a disabled state.
    */
   | 'disable all'
   // Tells Lightning to re-render the device UI. This gives other controls a
   // chance to display the latest hardware state (e.g. zeroing finished, so
   // status text can be updated).
   // If the state was to 'disable all', this will re-enable all elements.
   | 'refresh all';

export type DeviceActionStatus =
   | { type: 'not started' }
   /**
    * Set action status to 'started' when the action's work begins. A
    * progress indicator will show for the action.
    * */
   | { type: 'started'; options: DeviceActionStatusOptions }
   /**
    * Set status to failed if the action could not be performed.
    * Use @param message to inform the user of the problem with
    * instructions on what to do to continue.
    */
   | { type: 'failed'; message: string }
   /**
    * Set status to finished once the action completes successfully.
    */
   | { type: 'finished'; options: DeviceActionStatusOptions };

export type DeviceActionProgressCallback = (
   progress: DeviceActionStatus
) => void;

export interface IDeviceUIAction extends IDeviceUIElementBase {
   action: (callback?: DeviceActionProgressCallback) => void;

   /**
    * @property buttonText Text to be displayed within the action element.
    */
   buttonText: string;

   /**
    * @property label Optional text to show next to the action button.
    */
   label?: string;

   /**
    * @property disabled Optional function to determine (based on current
    * state of the settings or otherwise) whether the action control is to be
    * disabled in the UI.
    */
   calcDisabled?: (settings: HierarchyOfDeviceSettingsBase) => boolean;

   /**
    * @property actionInProgressText This is an optional label to display
    * inside the button while the action is being performed. Useful for long
    * running actions.
    */
   actionInProgressText?: string;
}

export interface IDeviceUIMultiStepActionStatus {
   activeStepIndex: number;
   activeStepStatus: DeviceActionStatus;
   activeStepError?: string;
}

export type DeviceMultiStepActionProgressCallback = (
   stepStatus: DeviceActionStatus
) => void;

export interface IDeviceUIActionStep {
   /**
    * Associated label for the action button.
    */
   label: string;

   /**
    * If specified, the instructional text associated with the action (e.g. tooltip
    * shown on hover of this step's button).
    */
   actionDescription?: string;

   /**
    * The hover text associated with a step that has been successfully performed.
    */
   actionPerformedDescription?: string;

   /**
    * Function that performs the action's work.
    *
    * @param callback Invoked when the action (which is non-blocking and may take
    * a noticeable amount of time) is complete. Failure to call this will result
    * in the UI showing a progress indicator indefinitely.
    */
   action: (callback: DeviceMultiStepActionProgressCallback) => void;
}

export interface IDeviceUIMultiStepAction extends IDeviceUIElementBase {
   /**
    * Optional label to associated with the multi-step action.
    */
   label?: string;

   /**
    * If defined, is the latest status obtained from Quark.
    */
   latestHardwareStatus?: IDeviceUIMultiStepActionStatus;

   steps: IDeviceUIActionStep[];
}

export interface IDeviceUICustomReact extends IDeviceUIElementBase {
   /**
    * Returns custom UI defined as a nested hierarchy of React components.
    *
    * @example
    * // Returns a single React button
    * return React.createElement(
    *    'button', {
    *       onClick: () => alert('Button was clicked')
    *    },
    *    'Button Created In Custom React!'
    * );
    *
    * @param react Provides access to the React run-time.
    *
    * See https://reactjs.org/ documentation.
    */
   custom: (react: any) => JSX.Element;
}

export interface IDataPreviewApi extends ILcModel {}

export interface IDeviceUISignalPreview extends IDeviceUIElementBase {
   // Intended for internal use only.
   preview?: {};
}

/**
 * All types of UI elements that can be displayed.
 *
 * If there is a device setting directly associated with the element,
 * use the 'setting' type which binds directly to the setting.
 *
 * The other types are useful for showing extra information to the
 * user or performing custom actions that don't affect settings such
 * ass zeroing a device.
 */
export type IUIElementApi =
   | ({ type: 'setting' } & IDeviceUISetting)
   | ({ type: 'adjustable-value' } & IDeviceUIAdjustableValue)
   | ({ type: 'read-only-value' } & IDeviceUIReadOnlyItem)
   | ({ type: 'header' } & IDeviceUIHeader)
   | ({ type: 'device-name' } & IDeviceUIHeader)
   | ({ type: 'message' } & IDeviceUIMessage)
   | ({ type: 'action' } & IDeviceUIAction)
   | ({ type: 'multi-step-action' } & IDeviceUIMultiStepAction)
   | ({ type: 'custom' } & IDeviceUICustomReact)
   | ({ type: 'signal-preview' } & IDeviceUISignalPreview);

export type UIAreaLayoutTypeApi =
   | 'default'
   | { type: 'custom'; cssClass: string };

export type StreamDescriptor = {
   deviceManager: IDeviceManagerApi;
   deviceId: DeviceProxyId;
   streamIndex: number;
};

export type PerformDeviceAction = (
   stream: StreamDescriptor,
   actionType: DeviceInputActionTypes,
   actionValue?: string,
   postActionStatusType?: DeviceInputStatusTypes,
   postActionCallbackIn?: () => void
) => Promise<string>;

export type GetStreamStatus = (
   streamDesc: StreamDescriptor,
   statusType: DeviceInputStatusTypes
) => string | undefined;

export interface IDeviceUIElementOptions {
   performAction: PerformDeviceAction;
   getStatus: GetStreamStatus;
}

/**
 * Describes a rectangular area of User Interface in LabChart Lightning.
 */
export interface IUIAreaApi {
   /**
    * Ordered collection of elements to show in the UI area.
    */
   elements: IUIElementApi[];

   /**
    * Controls how to layout elements within the UI area.
    */
   layout: UIAreaLayoutTypeApi;

   /**
    * Desired width and height of the area, in pixels.
    */
   desiredWidthPixels?: number;
   desiredHeightPixels?: number;

   /**
    * These were added because the GSR front-end needs to enter a special mode
    * where it allows (preview) sampling before zeroing has been performed.
    *
    * Open devices might need custom init/teardown for associated hardware.
    */
   onWillEnterDeviceUI?(): Promise<void>;
   onDidExitDeviceUI?(): Promise<void>;
}

/**
 * Describes the members that all custom Device UI plugins must implement.
 */
export interface IJsDeviceUI {
   /**
    * Called when LabChart Ligtning is evaluating which IJsDeviceUI
    * implementation it will use to display information for a specific
    * device.
    *
    * @param deviceClassGuid is the device's class unique guid.
    * @param deviceInternalName is the internal name of the device. This
    * should be used if the device class guid is not specific enough
    * or device supports being renamed.
    *
    * @returns true if this class will provide the UI for the device.
    */
   matchesDevice: (
      deviceClassGuid: string,
      deviceInternalName: string
   ) => boolean;

   /**
    * Defines the user interface elements that will be used to adjust basic rate / range settings
    * for this device. Optional.
    *
    * @param streamSettings settings for the current stream within the recording.
    * @param deviceId The device's id.
    * @param deviceManager Reference to the current device manager.
    */
   describeStreamSettingsUI?: (
      streamSettings: IDeviceStreamApi,
      deviceId: DeviceProxyId,
      deviceManager: IDeviceManagerApi,
      deviceProxy?: IDeviceProxyAPI
   ) => IUIAreaApi | undefined;

   /**
    * Defines the user interface elements that will be used to configure device-wide
    * hardware options. Optional.
    *
    * @param deviceSettings settings for the device.
    * @param deviceIndex The device's id.
    * @param deviceManager Reference to the current device manager.
    */
   describeDeviceSettingsUI?: (
      deviceSettings: IDeviceSettingsApi,
      deviceId: DeviceProxyId,
      deviceManager: IDeviceManagerApi,
      deviceProxy?: IDeviceProxyAPI
   ) => IUIAreaApi | undefined;
}

/**
 * Interface for any plugins that provide custom device class-specific User Interface.
 *
 * @example export class MyDeviceSettingsUI implements IDeviceUIApi { ... }
 */
export interface IDeviceUIApi extends IPluginModuleFeature, IJsDeviceUI {}
