const path = require('path');
const os = require('os');
const cpx = require('cpx');

function userDevicePluginsPath() {
   const result = path.join(
      os.homedir(),
      'Documents',
      'LabChart Lightning',
      'Plugins'
   );

   return result;
}

console.log(
   `Watching for changes to ./development, copying .js files to "${userDevicePluginsPath()}"`
);

cpx.watch('development/**/*[.js, .ts]', userDevicePluginsPath());
