import { IDeviceSetting, IDeviceOption, DeviceValueType } from './device-api';

/**
 * Implementation of a setting for an open device.
 *
 * Motivation for adding to open API: There's enough complexity in
 * here now that it's not reasonable to expect device implementors to absorb
 * it all and do it in their own device plugins.
 *
 * @author Peter Suggate
 */

export class Setting implements IDeviceSetting {
   settingName: string;
   options: IDeviceOption[];
   value: DeviceValueType;
   display?: string; // This is computed from value and options.

   setValue(other: IDeviceSetting) {
      this.value = other.value;
   }

   constructor(
      rawSetting: IDeviceSetting,
      onValueSet: (
         setting: IDeviceSetting,
         newValue: DeviceValueType
      ) => DeviceValueType,
      displayFromValue?: (value: DeviceValueType) => string
   ) {
      const { settingName, value, options } = rawSetting;

      this.settingName = settingName;

      let _value = value;
      Object.defineProperty(this, 'value', {
         enumerable: true,
         get: function() {
            return _value;
         },
         set: function(newValue: DeviceValueType) {
            if (newValue === _value) return;
            _value = newValue;
            _value = onValueSet(this, newValue); //support coercion of value to valid option
         }
      });

      Object.defineProperty(this, 'display', {
         enumerable: true,
         get: function() {
            if (displayFromValue) {
               return displayFromValue(_value);
            } else if (options) {
               const option = options.find(o => o.value === _value);
               if (option !== undefined) {
                  return option.display;
               }
            }

            return value.toString();
         }
      });

      this.options = options;
   }
}
