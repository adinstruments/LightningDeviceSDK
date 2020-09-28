# LightningDeviceSDK Device UI

**The LightningDeviceSDK is currently under development and is subject to change.**

## Inter-device time synchronization

Lightning supports sampling from multiple devices at the same time into a single recording. Users will naturally assume that all the signal traces seen in the UI will have the same time axis, but in general there will some error, comprised of an initial time offset at the start of sampling and a rate error or drift between the clocks in different devices causing an error that increases with time.

The initial offset error is caused by devices starting sampling at slightly different times.
The rate error is caused by the crystal oscillators in the devices not having exactly the same frequency error.

There are currently three techniques Lightning can use to reduce both these types of error which can result in adequate synchronisation for many purposes. These techniques rely on Lightning resampling data from the devices, using information provided by those devices, so the recorded samples are aligned as accurately as possible across channels.

These techniques are:
1. USB-frame time synch (typical error +/- 50 µs, potential error < +/- 1µs for SAMD USB locked devices)
2. Round-trip time synch (typical error +/- 1 ms)
3. Sample-counting time synch (typical error +/- 100 ms)

### USB-frame time synch
USB-frame time synch is the most accurate technique and is currently used by PowerLabs. It requires that the devices are plugged into the same USB hub so the USB Start Of Frame (SOF) signal can be used to provide a common 'clock' that can be read by all devices. This results in an error < +/- 50 us for devices with firmware support for this.

The SDK provides example firmware for MicroChip SAMD51 and SAMD21 microcontrollers showing how to lock the master clock (used to initiate Analog to Digital Converter (ADC) conversions) to the USB Start of Frame signal using the Digital Frequency Locked Loop (DFLL) feature provided by these processors. Because of the highly accurate inter-device timing enabled by this scheme, we recommend using the SAMD51 or SAMD21 series for new designs.

### Round-trip time synch
Round-trip time synch can provide an error < +/- 1 ms and requires the firmware and the device script to implement support for two measurements:
1. an immediate read of the device's clock
2. the time of the device's clock at which the first sample in the sampling session was measured

The ArduinoRoundTrip.ts script in the SDK, along with the example firmware for the Arduino (DueLightning, SAMD51Lightning and SAMDLightning) show how to implement the two measurments required for round-trip time synch.
To support Round-trip time synch the ProxyDevice in the Typescript device script must implement 3 methods:
- getRemoteTimePointInfo()
- getRemoteTime()
- onRemoteTimeEvent()

### Sample-counting time synch
Sample-counting time synch requires no support from the device script or the firmware, so Lightning falls back to using this if the ProxyDevice in the device script does not implement the 3 methods required for round-trip timing.

For sample-counting time synch Lightning counts the samples from each device and assumes that over a long time period the same number of samples should arrive from each device, when corrected for the nominal sampling rate of each signal. This generally results in an inter-device timing error within +/- 100 ms for devices with a crystal oscillator rate error < 1 part in 10000.

The ArduinoNoSync.ts script in the SDK shows how to reduce the initial time offset error for sample-counting time synch by implementing: 
 - getStartDelayMicroSeconds()
 - getLocalClockTickAtSamplingStart()

 The first function allows a known fixed delay between the device being told to start sampling and the first sample being captured to be compensated for by shifting the device's data relative to the other devices.

The second function allow the device script to read the time of the PCs clock at an event that is most consistent relative to the time the device actually started sampling, e.g. just before or just after the start sampling command was sent, or when the first sample is received.

 This device script will work with the same Arduino firmware as the ArduinoRoundTrip.ts script. It simply does not implement the methods needed for round-trip support.


