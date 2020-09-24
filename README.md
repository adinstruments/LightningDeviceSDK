# LightningDeviceSDK

[Get LabChart Lightning](https://go.adinstruments.com/integrationLCLtrial): Take advantage of our free 30 day trial while you are in the setup phase of your plugin.

[Find out more](https://go.adinstruments.com/LCLIntegrationCWS): Benefits of integrating with LabChart Lightning and options for enhanced promotion and sales growth opportunities.

[Tell us about yourself](https://go.adinstruments.com/l/21302/2020-09-17/5qnltg): if you want to, fill out our contact form and we can notify you with new resources and promotional opportunities that will help get your device in front of researchers.

The LightningDeviceSDK provides functionality to write device connection plugins in Typescript for LabChart Lightning. This repo does not provide any functionality, only example files and typed interfaces. You will need LabChart Lightning with a valid license in order to run your device plugin.

**\*\*The LightningDeviceSDK is currently under development and is subject to change.\*\***

### Supported Device Classes

-  Serial
-  More to come...

## Change log

See [Changelog](CHANGELOG.md).

## Upcoming features

-  Arduino cores to improve device synchronization for SAMD51 and SAMD21 based boards
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
- Arduino IDE - https://www.arduino.cc/en/Main/Software
   - Arduino core(s) for the intended board(s)
   - Optionally, the Arduino extension for Visual Studio Code

Clone this repo to your working environment

Install packages that will assist with development:

```
npm install
```

Note: `npm` is the Node Package Manager which comes with Node.js and should already be installed with the steps above.

In order for your plugin to be loaded by Lightning it must be placed into the following location (it is up to you to create these folders or simply run `npm run watch` explained below):

(Windows)  
`C:\Users\[USERNAME]\Documents\LabChart Lightning\Plugins\devices`

(macOS)  
`~/Documents/LabChart Lightning/Plugins/devices`

It is often useful during development to iterate rapidly and see the resulting changes as early as possible. For this, you can open a terminal and run:

```
npm run watch
```

This watches for any changes to `.js` or `.ts` files located under `./development/`, automatically copying the updated file(s) to the LabChart Lightning plugins folder.

LabChart Lightning must be relaunched in order to pick up device plugin changes.

## Overview

To get started implementing a device plugin, see the [Overview](OVERVIEW.md).

## Advanced Topics

Customizing Lightning's [user interface](DEVICE-UI.md) for your device.

Inter-device time synchronization [time synch](TIME-SYNCH.md)

## License

BSD 3-Clause Clear
