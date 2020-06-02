# LightningDeviceSDK Change Log


### v0.1.4 - 3/09/2020
- Added support for serial port options(SerialPortOptions)
   - Baud rate
   - Flow control 
   - Parity
   - Stop bits
   - Character size
- Updated example files to include support for multiple devices in Lightning

### v0.1.3 - 9/04/2020
 - Chanced name to LightningDeviceSDK
 - Initial commit under the ADInstruments account

### v0.1.2 - 11/03/2020
- Updates to device-api.ts
   - Added 'version' to IDeviceProxySettingsSys 
   - Removed ADI specific fucntions
   - Full interface for IProxyDevice
   - Full interface for IDeviceClass
   - TDeviceConnectionType now available
   - See commit for more detailed changes
- Added in new public api files.
   - device-settings.ts
   - device=streams.ts
   - device-units.ts
   - stream-ring-buffer.ts
- Removed .js examples as they were hard to maintain. 
- Removed Minimal.ts example for the same reason. 
- Fixed up TestDevice and OpenBCI for new API changes.

### v0.1.1 - 16/01/2020
- Plugins now load from User/Documents/LabChart Lightning, instead of AppData
- Added Typescript and @types/node to dev dependencies
- Changed devsync.js to copy to User/Documents, instead of AppData
- Lightning now has Typescript support, so plugins can be written in Typescript, with a few caveats.
- Added Minimal.ts and OpenBCI.ts as starting points for Typescript development.
- getTimems is not available in Typescript pluins, but an implementation can be copied from minimal.ts
- moved all interfaces into a single device-api.ts file under public
- added tsconfig for Typescript errors


### v0.1 - 15/10/2019
- Overview filled out
- package.json added
- watch, lint and prettier added. Copies Development folder to Lightning Plugins folder
- Added images for documentation'
- Added some documentation to interfaces

### v0.01 - 14/10/2019
- Initial commit
