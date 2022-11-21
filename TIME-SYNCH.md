# LightningDeviceSDK Device UI

**The LightningDeviceSDK is currently under development and is subject to change.**

## Inter-device time synchronization

Lightning supports sampling from multiple devices at the same time into a single recording. Users will naturally assume that all the signal traces seen in the UI will have the same time axis, but in general there will some error, comprised of an initial time offset at the start of sampling and a rate error or drift between the clocks in different devices causing an error that increases with time.

The initial offset error is caused by devices starting sampling at slightly different times.
The rate error is caused by the crystal oscillators in the devices having (generally small) frequency errors.

There are currently four techniques Lightning can use to reduce both these types of error. Using these can result in adequate synchronisation for many purposes. 

These techniques are:
1. USB locked devices (typical error < +/- 1µs, if they support 'Start on USB frame')
2. USB-frame time sync (typical error +/- 50 µs)
3. Round-trip time sync (typical error +/- 1 ms)
4. Sample-counting time sync (typical error +/- 100 ms)

When more than one device is being used in a recording, one device is designated the "primary device". The samples in the fastest channel from this device (i.e. "ticks") are used to determine the timing for the recording, i.e. the time from the start of block shown in the Chart View. 

Three of these techniques (2, 3, 4) rely on Lightning resampling data from the non-primary devices, using timing information provided by those devices, so the recorded samples are aligned as accurately as possible with the "ticks" from the primary device, across channels.

If the primary device supports "USB locked" time synchronization (1.), any other devices that support "USB locked" time synchronization do not need to have their samples resampled by Lightning to match the rate of the primary device. In this case, these other devices are also effectively "primary" devices.

In the Arduino examples (e.g. SAMD51Lightning.ino) the time sync capabilities of the device are reported in the version information returned from the firmware in response to the 'v' command, as specified by the ADIDeviceSynchModes enumeration. Responding with kDeviceSynchNone will result in "Sample-counting time sync" with an inter-device timing error of the order of +/- 100 ms.

### USB-frame time sync

Both USB sync techiques (1. and 2.) require that the devices are plugged into the same USB hub so the USB Start Of Frame (SOF) signal can be used to provide a common 'clock' that can be read by all the devices.

USB locking (1.) with 'Start on USB frame' is the most accurate technique and is used by the PowerLab C-Series. The SDK provides example firmware for MicroChip SAMD51 and SAMD21 microcontrollers showing how implement this by locking the master clock (used to initiate Analog to Digital Converter (ADC) conversions) to the USB Start of Frame signal using the Digital Frequency Locked Loop (DFLL) feature provided by these processors. Because of the highly accurate inter-device timing enabled by this scheme, we recommend using the SAMD51 series for new designs.

USB-frame time sync (2.) is the next most accurate technique and is currently used by older PowerLabs. This is simpler to implement in firmware since the firmware only needs to measure the time of the latest USB Start Of Frame interrupt so this can be reported to Lighting when requested. No phase locking is needed.


To support USB-frame time sync the Arduino device firmware needs to support:
1. the 'v' ('Version) command returning "deviceSynchModes: kDeviceSyncRoundTrip | kDeviceSyncUSBFrameTimes"
2. the 'n' ('Now') command (see Round-trip time sync below)
3. the 'f' ('First sample time') command (see Round-trip time sync below)
4. the 'u' ('time of last Usb SOF') command which returns the time and USB frame number of the last USB SOF interrupt.

The kDeviceSyncRoundTrip option is needed to obtain measurements of the offset of the device's clock from the host PC's clock so that the 'First sample time' reported by the device can be used to correctly offset that device's samples relative to those of the primary device (the time source for the recording).

The kDeviceSyncUSBFrameTimes option means the Lightning will send a 'u' command to the device once every second. The device time and USB frame number returned from the device are compared with that returned from the primary device and used to resample the data from the non-primary devices so that their sample rate matches that of the primary device.

It is essential that the timer used to measure the time of the USB Start Of Frame (SOF) interrupt is driven from the same clock that drives the ADC sample conversions. 

Inaddition to the time of the last USB SOF interrupt and corresponding 11 bit frame number, the 'u' command needs to return the time the 'u' command is received. Lightning uses this time for sanity checking purposes.
The kDeviceSyncUSBFrameTimes option results in an inter-device timing error < +/- 50 us.

The most accurate time sync mode, USB locking (1.) with 'Start on USB frame', is activated by the version command reporting "deviceSyncModes: kDeviceSynchUSBFullSuppport". Depending on the firmware, this is capable of providing sub-microsecond timing accuracy relative to the primary device. In addition to the above commands, this mode requires the firmware to support:

5. Phase locking the timer (or the whole CPU clock as done by SAMD51Lightning.ino) used by the ADC to the USB SOF interrupts.
6. Handling the optional 11 bit future USB frame number sent in the 'b' ('Begin sampling) command and starting sampling on the USB SOF interrupt corresponding to that USB frame.

Note that if device chosen to be the primary device does not support USB locking, samples from non-primary USB locked device will be resampled, resulting in the timing error relative to the primary device increasing to at best +/- 50 µs.

### Round-trip time sync
Round-trip time sync can provide an error < +/- 1 ms and requires the firmware and the device script to implement support for two measurements:
1. an immediate read of the device's clock
2. the time of the device's clock at which the first sample in the sampling session was measured

The ArduinoRoundTrip.ts script in the SDK, along with the example firmware for the Arduino (DueLightning, SAMD51Lightning and SAMDLightning) show how to implement the two measurements required for round-trip time sync.
To support Round-trip time sync the ProxyDevice in the Typescript device script must implement 3 methods:
- getRemoteTimePointInfo()
- getRemoteTime()
- onRemoteTimeEvent()

For the Arduino example firmwares, e.g. SAMD51Lightning or DueLightning, the getRemoteTime() method results in the 'n' ('now') command being sent to the device. On receiving this command, the device should immediately read the value of a timer in the device (ideally with microsecond resolution or better) that is driven from the same clock used to generate the samples.
In addition, the device firmware needs to read that same timer when the first sample in the sampling session (started by the 'b' ('begin') command) is sampled. This first sample time should be stored and then returned when the 'f' ('first sample time') command  is received, shortly after the start of the sampling session.

### Sample-counting time sync
Sample-counting time sync requires no support from the device script or the firmware, so Lightning falls back to using this if the ProxyDevice in the device script does not implement the 3 methods required for round-trip timing.

For sample-counting time sync, Lightning counts the samples from each device and assumes that over a long time period the same number of samples should arrive from each device, when corrected for the nominal sampling rate of each signal. This generally results in an inter-device timing error within +/- 100 ms for devices with a crystal oscillator rate error < 1 part in 10000.

The ArduinoExample.ts script in the SDK shows how to reduce the initial time offset error for sample-counting time sync by implementing: 
 - getStartDelayMicroSeconds()
 - getLocalClockTickAtSamplingStart()

 The first function allows a known fixed delay between the device being told to start sampling and the first sample being captured to be compensated for by shifting the device's data relative to the other devices.

The second function allow the device script to read the time of the PCs clock at an event that is most consistent relative to the time the device actually started sampling, e.g. just before or just after the start sampling command was sent, or when the first sample is received.



