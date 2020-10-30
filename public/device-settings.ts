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
   value: DeviceValueType;    //This implemented using Object.defineProperty()
   _value: DeviceValueType;   //The actual value backing the value property
   display?: string; // This is computed from value and options.

   setValue(other: IDeviceSetting) {
      this.value = other.value;
   }

   /**
    * Applies current setting value down to the hardware by invoking invoking
    * any onValueSet() callback.
    *
    * To be called once when the physical device is first connected to the
    * recording's proxy.
    */
   sendToHardware(): void {
      this.onValueSet(this, this.value);
   }

   /**
    * Access the current value as a number. Throws if setting holds a string or
    * boolean value so should only be used when the setting is guaranteed to
    * hold a number.
    */
   get asNumber(): number {
      if (typeof this._value !== 'number') {
         throw Error(
            `Attempting to access setting '${this.settingName}' value as a number but it isn't one. Current value is: ${this.value}`
         );
      }

      return this._value as number;
   }


   constructor(
      rawSetting: IDeviceSetting,
      private onValueSet: (
         setting: Setting,
         newValue: DeviceValueType
      ) => DeviceValueType,
      displayFromValue?: (value: DeviceValueType) => string,

   ) {
      const { settingName, value, options } = rawSetting;

      this.settingName = settingName;

      this._value = value;

      //Need to use Object.defineProperty() because get style properties are not accessible
      //from Quark.
      Object.defineProperty(this, 'value', {
         enumerable: true,
         get: function () {
            return this._value;
         },
         set: function (newValue: DeviceValueType) {
            if (newValue === this._value) return;
            this._value = newValue;
            this._value = onValueSet(this, newValue); //support coercion of value to valid option
         }
      });

      Object.defineProperty(this, 'display', {
         enumerable: true,
         get: function () {
            if (displayFromValue) {
               return displayFromValue(this._value);
            } else if (options) {
               const option = options.find(o => o.value === this._value);
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
