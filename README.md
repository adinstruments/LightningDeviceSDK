# LightningDeviceSDK

[Get LabChart Lightning](https://go.adinstruments.com/integrationLCLtrial): Take advantage of our free 30 day trial while you are in the setup phase of your plugin.

[Find out more](https://go.adinstruments.com/LCLIntegrationCWS): Benefits of integrating with LabChart Lightning and options for enhanced promotion and sales growth opportunities.

[Tell us about yourself](https://go.adinstruments.com/l/21302/2020-09-17/5qnltg): if you want to, fill out our contact form and we can notify you with new resources and promotional opportunities that will help get your device in front of researchers.

The LightningDeviceSDK provides functionality to write device connection plugins in Typescript for LabChart Lightning. This repo does not provide any functionality, only example files and typed interfaces. You will need LabChart Lightning with a valid license in order to run your device plugin.

**\*\*The LightningDeviceSDK is currently under development and is subject to change.\*\***

### Supported Device Classes

-  Serial
-  Bluetooth over Serial (Serial Port Profile)
-  More to come...

## Change log

See [Changelog](CHANGELOG.md).

## Upcoming features

-  Better than 10 microsecond inter-device synchronization over USB for Microchip ARM SAMD51 and SAMD21 based devices (e.g. Adafruit Feather M4, M0 etc. and  Sparkfun Thing+ SAMD51)
-  Calling arbitrary proxy functions from custom UI
-  Plugins work for non-admin users 
-  Better error messaging

## Getting Started

### Minimum Requirements

-  LabChart Lightning
-  A text editor

### Recommended Device Development Workflow

When starting out, it is useful to be able to detect possible device implementation errors early, plus make and test improvements rapidly. Therefore, it is strongly recommended to do the following.

Install the needed dependencies:

-  Node.js - https://nodejs.org/en/download/
-  Visual Studio Code - https://code.visualstudio.com/download
   -  Install VS Code extension: ESLint

If you're developing Arduino firmware:
- Arduino IDE - https://www.arduino.cc/en/Main/Software
   - Arduino core(s) for the intended board(s)
   - For best possible time synchronization between devices over USB, we recommend SAM51 based boards, e.g. (e.g. Adafruit Feather M4 etc. and  Sparkfun Thing+ SAMD51)
   - Optionally, the Arduino extension for Visual Studio Code

Clone this repo to your working environment

Install packages that will assist with development:

```
npm install
```

Note: `npm` is the Node Package Manager which comes with Node.js and should already be installed with the steps above.

In order for your plugin to be loaded by Lightning it must be placed into the following location: 

(Windows)  
`C:\Users\[USERNAME]\Documents\LabChart Lightning\Plugins\devices`

(macOS)  
`~/Documents/LabChart Lightning/Plugins/devices`

You can create these folders manually or simply place your plugin source folder under the SDK's `./development/` folder and run `npm run watch`. 

I.e. open a terminal in SDK's root folder and run:

```
npm run watch
```

This watches for any changes to `.js` or `.ts` files located under `./development/`, automatically copying the updated file(s) to the LabChart Lightning plugins folder. This is useful during development when iterating rapidly so you can see the resulting changes as early as possible.

LabChart Lightning must be relaunched in order to pick up device plugin changes.

## Overview

To get started implementing a device plugin, see the [Overview](OVERVIEW.md).

## Advanced Topics

Customizing Lightning's [user interface](DEVICE-UI.md) for your device.

Inter-device time synchronization [time synch](TIME-SYNCH.md)

## License

BSD 3-Clause Clear
