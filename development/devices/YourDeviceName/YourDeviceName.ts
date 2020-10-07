export class DeviceClass {
    constructor() {
        console.log('In the constructor');
    }
}

module.exports = {
    getDeviceClasses() {
       return [new DeviceClass()];
    }
};