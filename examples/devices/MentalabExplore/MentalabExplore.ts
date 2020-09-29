'use strict';
/**
 * Device driver for the Mentalab Explore device.
 *
 * Notes:
 * - Quark is Lightning's C++ sampling engine.
 * - In order for this file to be registered by Lightning, it must be located
 *   under C:\Users\[USERNAME]\Documents\LabChart Lightning\Plugins\devices
 *   or ~/Documents/LabChart Lightning/Plugins/devices (Mac)
 * - Technical term: "Device class" is the set of types of device that can share
 *  the same settings.
 * - The device-api contains Typescript interfaces that essential describe the
 * functionality quark is expecting, as well as utility functions
 *
 * This file contains definitions for four necessary objects:
 *
 * - PhysicalDevice: an object that is a representation of the connected
 * hardware device.
 *   Multiple recordings can use the same PhysicalDevice, but only one can
 * sample with that device at any time.
 * - ProxyDevice: an object that is created for each recording to represent
 * the PhysicalDevice.
 *   Manages the device settings and access to sampling for that recording.
 * - DeviceClass: an object that represents the devices of that class or type,
 * and can find and create a PhysicalDevice objects of its class, as well as the
 * ProxyDevice objects.
 *  - Parser: on object that processes incoming data. You only want one of these
 * receiveing data. It is owned by the PhysicalDevice.
 */

import { DeviceClass } from './deviceClass';

module.exports = {
   getDeviceClasses() {
      return [new DeviceClass()];
   }
};
