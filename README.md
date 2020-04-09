# LightningDeviceSDK

The LightningDeviceSDK provides functionality to write device connection plugins in Javascript/Typescript for LabChart Lightning. This repo does not provide any functionality, only example files and typed interfaces. You will need LabChart Lightning with a valid license in order to run your device plugin.

**\*\*The LightningDeviceSDK is currently under development and is subject to change.\*\***

### Supported Device Classes

-  Serial
-  More to come...

## Change log

See [Changelog](CHANGELOG.md).

## Upcoming features

-  Custom baud rates(The baud rate is currently set to 115200 for all devices)
-  Multiple device syncronization
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

Clone this repo to your working environment

Install packages that will assist with development:

```
npm install
```

Note: `npm` is the Node Package Manager which comes with Node.js and should already be installed with the steps above.

It is recommended to use ESLint to validate your Javascript as you're writing your device plugin:

Run eslint on all source files under `development/`:

```
npm run lint
```

Or for an individual file:

```
npx run eslint yourFile.js
```

In order for your plugin to be loaded by Lighting it must be placed into the following location:

(Windows)  
`C:\Users\[USERNAME]\Documents\LabChart Lightning\Plugins\devices`

(macOS)  
`~/Library/Documents/LabChart Lightning/Plugins/devices`

It is often useful during development to iterate rapidly and see the resulting changes as early as possible. For this, you can open a terminal and run:

```
npm run watch
```

This watches for any changes to `.js` or `.ts` files located under `./development/`, automatically copying the updated file(s) to the LabChart Lightning plugins folder.

LabChart Lightning must be relaunched in order to pick up device plugin changes.

## Overview

To get started implementing a device plugin, see the [Overview](OVERVIEW.md).

## License

BSD 3-Clause Clear
