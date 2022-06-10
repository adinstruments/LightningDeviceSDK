'use strict';

/**
 * Device driver for FMS Nano Core OEM
 *
 * Notes:
 * - Quark is Lightning's C++ sampling engine.
 * - In order for this file to be registered by Lightning, it must be located
 *   under [LIGHTNING_INSTALL_DIR]/resources/app/devices
 * - Technical term: "Device class" is the set of types of device that can share the same settings.
 *
 * This file contains definitions for three necessary objects:
 *
 * 1. PhysicalDevice: an object that is a representation of the connected hardware device.
 *    Multiple recordings can use the same PhysicalDevice, but only one can sample with that device at any time.
 *
 * 2. ProxyDevice: an object that is created for each recording to represent the PhysicalDevice.
 *    Manages the device settings and access to sampling for that recording.
 *
 * 3. DeviceClass: an object that represents the device class and can find and create PhysicalDevice
 *    objects of its class, as well as the ProxyDevice objects.
 */

import { DeviceClass } from './deviceClass';
import { NIBPNanoUI } from './deviceSettingsUI';

module.exports = {
   getDeviceClasses() {
      return [new DeviceClass()];
   },
   getDeviceUIClasses() {
      return [new NIBPNanoUI()];
   }
};
