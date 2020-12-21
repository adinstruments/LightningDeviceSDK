/*
This Teensy 4.1 firmware contains two different timing examples.

INTERRUPT_TIMER uses interrupts to call a mock data sampling function.
See https://www.pjrc.com/teensy/td_timing_IntervalTimer.html

An alternative is to define ADC_TIMER. We use this library to directly 
connect to the ADC for improved timing. This example takes input data on pin A0.

Documentation for the ADC library is at:
https://forum.pjrc.com/threads/25532-ADC-library-update-now-with-support-for-Teensy-3-1
http://pedvide.github.io/ADC/docs/Teensy_4_html/class_a_d_c___module.html#ab65bd1bb76ab7fbf4743c0e1bf456cb7
See also src/ADCExample.io for a concise example.

For a pin layout see https://www.pjrc.com/teensy-4-1-released/.
*/

// One of these two timing options should be commented out.
#define INTERRUPT_TIMER
// #define ADC_TIMER

#define __get_PRIMASK __get_primask
#define __set_PRIMASK __set_primask

#include <cmath>
#include <vector>
#include "src/RingBufferSized.h"
#include "Arduino.h"
#include <util/atomic.h>

#ifdef ADC_TIMER

#include <ADC.h>
#include <ADC_util.h>

int LEDpin = 5;
int PWMpin = 19;
const int readPin1 = A0;
const int readPin2 = A1;

#endif // ADC_TIMER

const int kADCChannels = 2;
const char *kSerialNumber = "00001";
const char *kFWVersion = "0.0.1";
const int ledPin = 13; // the pin with a LED
int ledState = LOW;
volatile double gPhase = 0;
std::vector<double> gGains(kADCChannels, 1.0); // no gain set for now.
const int kDefaultADCPointsPerSec = 100;
int gADCPointsPerSec = kDefaultADCPointsPerSec; //~5000 max with 2 samples (1 point) per packet
const int kSampleRates[] = {10000, 4000, 2000, 1000, 400, 200, 100};
const int kSamplePeriodms = 1.0 / kDefaultADCPointsPerSec * 1e6 ;
const int kNSampleRates = sizeof(kSampleRates) / sizeof(int);
const int kADCStartChan = 2; //A1
const int kADCEndChan = kADCStartChan + kADCChannels;
const int kBytesPerSample = sizeof(int16_t);

//Statically allocating individual buffers larger than this causes the firmware to crash for some reason
const int kTotalBufferSpaceBytes = kADCChannels < 2 ? 32000 : 64000;
const int kBufferPoints = kTotalBufferSpaceBytes / kBytesPerSample / kADCChannels;
typedef RingBufferSized<int16_t, kBufferPoints> TRingBuf;
TRingBuf gSampleBuffers[kADCChannels];

#ifdef INTERRUPT_TIMER
IntervalTimer interruptTimer;
#endif // INTERRUPT_TIMER

#ifdef ADC_TIMER
ADC *adc = new ADC(); // adc object;
#endif                // ADC_TIMER

enum ADIDeviceSynchModes
{
  kDeviceSynchNone = 0 | 0,
  kDeviceSyncRoundTrip = 1 | 0,
  // would like all future connection to be these types. C series compatable and us timing
  kDeviceSyncUSBFrameTimes = 2 | 0,
  kDeviceSynchUSBLocked = 4 | 0
};

void debugNewLine()
{
  //Serial.write('\n'); //Readability while testing only!
}

inline uint32_t saveIRQState(void)
{
  uint32_t pmask = __get_PRIMASK() & 1;
  __set_PRIMASK(1);
  return pmask;
}

inline void restoreIRQState(uint32_t pmask)
{
  __set_PRIMASK(pmask);
}

volatile bool gUSBBPinState = false;
const int outputTestPin = 2;

void mockSampleData()
{
  const double kPi = 3.1415926535897932384626433832795;
  const double kSinewaveFreqHz = 1;
  const double kDefaultSampleRate = 100;
  const double kSamplerClockRateOffset = 0.0;
  const double radsPerSamplePerHz = kSinewaveFreqHz * 2 * kPi / kDefaultSampleRate * (1.0 - kSamplerClockRateOffset);
  const int kFullScaleADCUnits = 0x7fff; //16 bits
  const double kAmp = kFullScaleADCUnits; //

  for (int i(0); i < kADCChannels; ++i) // One sample per input per timer tick. Driven by timer
  {
    const double measuredAmp = kAmp * gGains[i];
    double result = measuredAmp * sin(gPhase);

    if ((i & 1)) //Square wave on odd channels
      result = std::signbit(result) ? -measuredAmp : measuredAmp;

    int16_t iResult = result;
    gSampleBuffers[i].Push(iResult);
  }
  gPhase += radsPerSamplePerHz;
  gPhase = fmod(gPhase, 2 * kPi);
}

const int kMaxCommandLenBytes = 64;

const int kPointsPerPacket = 1;
const int kPointsPerMediumSizePacket = 10;

int gADCPointsPerPacket = kPointsPerPacket;

volatile int32_t gFirstADCPointus = 0;

enum State
{
  kIdle,
  kWaitingForUSBSOF,
  kStartingSampling,
  kHadFirstSample,
  kSampling,
};

volatile State gState = kIdle;
volatile bool gFirstSampleTimeRequested = false;

volatile bool gADCstate = false;

const int kDFLLFineMax = 511;
const int kDFLLFineMin = -512;

extern "C" void UDD_Handler(void);

const uint32_t kUSBFramePeriodus = 1000;

volatile uint16_t gLastFrameNumber = 0;
volatile int32_t gPrevFrameTick = -1;

volatile int gLastDCOControlVal = 0;

const int kHighSpeedTimerTicksPerus = 4;
const int kHighSpeedTimerTicksPerUSBFrame = 1000 * kHighSpeedTimerTicksPerus;

const int kOneOverLeadGainus = 1; // 1/proportional gain

const int kOneOverLagGainus = 2048; // 1/integral gain
const int kOneOverClippedLeadGainus = 1;

const int kFixedPointScaling = kOneOverLagGainus * kHighSpeedTimerTicksPerus;

//Integrator for integral feedback to remove DC error
volatile int32_t sPSDPhaseAccum = 0;

//First order LPF for lead (proportional) feedback
volatile int32_t gLeadPhaseAccum = 0;
const int kLeadPhaseTC = 16;

volatile int32_t gLastUSBSOFTimeus = 0;

void setup()
{
  auto irqState = saveIRQState();

  restoreIRQState(irqState);

  Serial.begin(0); //baud rate is ignored
  while (!Serial)
    ;

  Serial.setTimeout(50);

#ifdef ADC_TIMER

  ///// ADC0 ////
  adc->adc0->setAveraging(1);                                           // set number of averages
  adc->adc0->setResolution(16);                                         // set bits of resolution
  adc->adc0->setConversionSpeed(ADC_CONVERSION_SPEED::VERY_HIGH_SPEED); // change the conversion speed
  adc->adc0->setSamplingSpeed(ADC_SAMPLING_SPEED::VERY_HIGH_SPEED);     // change the sampling speed
  doStart(kDefaultADCPointsPerSec);

#endif // ADC_TIMER
}

class PacketBase
{
protected:
  static uint8_t sPacketCount;
};

uint8_t PacketBase::sPacketCount = 0;

class Packet : protected PacketBase
{
  //The header is 5 nibbles, i.e. "P\xA0\x40". The low nibble of the
  //3rd byte is the packet time (0x04) for data packets.
  //The head and packet type is followed by a 1 byte packet count number,
  //making a total of 4 bytes before the payload daya that need to match the
  //expected pattern(s) before the client can detect a packet.
  const char sHeader[2] = {'P', 0xA0};

public:
  static void ResetPacketCount()
  {
    sPacketCount = 0;
  }

  Packet() : mPoint(0)
  {
  }

  bool addSample(int chan, int16_t sample)
  {
    if (mPoint >= gADCPointsPerPacket)
      return false;

#ifdef ADC_TIMER
    mData[mPoint][chan] = (sample << 4) - 0x8000;
#endif //ADC_TIMER

#ifdef INTERRUPT_TIMER
    mData[mPoint][chan] = sample;
#endif //

    return true;
  }

  void nextPoint()
  {
    ++mPoint;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeader, 2);
    //Write the packet type byte (D for data, M for medium sized data packet)
    n += stream.write(uint8_t(gADCPointsPerPacket == 1 ? 'D' : 'M'));
    n += stream.write(sPacketCount++);
    n += stream.write(reinterpret_cast<const uint8_t *>(mData), sizeof(int16_t) * kADCChannels * gADCPointsPerPacket);
    return n;
  }

protected:
  int mPoint;
  int16_t mData[kPointsPerMediumSizePacket][kADCChannels];
};

class TimePacket : protected PacketBase
{
  const char sHeaderAndPacketType[3] = {'P', 0xA0, 'N'}; //'N' for now

public:
  TimePacket(int32_t tick32us, uint8_t timeRequestNumber) : mTimeRequestNumber(timeRequestNumber)
  {
    mData[0] = tick32us;
  }

  int writeData(Stream &stream) const
  {
    int n = stream.write(sPacketCount++);
    n += stream.write(mTimeRequestNumber);
    n += stream.write(reinterpret_cast<const uint8_t *>(mData), sizeof(mData));
    return n;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeaderAndPacketType, 3);
    n += writeData(stream);
    return n;
  }

protected:
  int32_t mData[1];
  uint8_t mTimeRequestNumber;
};

class LatestUSBFrameTimePacket : protected TimePacket
{
  const char sHeaderAndPacketType[3] = {'P', 0xA0, 'L'}; //'L' for latest USB Start Of Frame time

public:
  LatestUSBFrameTimePacket(int32_t tick32us, uint8_t timeRequestNumber, uint16_t frameNumber, int32_t latestFrameus) : TimePacket(tick32us, timeRequestNumber)
  {
    mFrameNumber = frameNumber;
    mFrameTimeus = latestFrameus;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeaderAndPacketType, 3);
    n += TimePacket::writeData(stream);
    n += stream.write(reinterpret_cast<const uint8_t *>(&mFrameNumber), sizeof(mFrameNumber));
    n += stream.write(reinterpret_cast<const uint8_t *>(&mFrameTimeus), sizeof(mFrameTimeus));
    return n;
  }

protected:
  uint16_t mFrameNumber;
  int32_t mFrameTimeus;
};

class FirstSampleTimePacket : protected PacketBase
{
  const char sHeaderAndPacketType[3] = {'P', 0xA0, 'F'}; //'F' for First sample time

public:
  FirstSampleTimePacket(int32_t tick32us)
  {
    mData[0] = tick32us;
  }

  //returns number of bytes written
  int write(Stream &stream) const
  {
    int n = stream.write(sHeaderAndPacketType, 3);
    n += stream.write(sPacketCount++);
    n += stream.write(reinterpret_cast<const uint8_t *>(mData), sizeof(mData));
    return n;
  }

protected:
  int32_t mData[1];
};

void StartSampling()
{
  for (int chan(0); chan < kADCChannels; ++chan)
  {
    auto &buffer = gSampleBuffers[chan];
    buffer.Clear();
  }

#ifdef INTERRUPT_TIMER
  interruptTimer.begin(mockSampleData, kSamplePeriodms);
#endif // INTERRUPT_TIMER

  gState = kWaitingForUSBSOF;

  digitalWrite(ledPin, HIGH);
}

void StopSampling()
{
  gState = kIdle;
  gFirstSampleTimeRequested = false;

#ifdef INTERRUPT_TIMER
  interruptTimer.end();
#endif // INTERRUPT_TIMER

  for (int chan(0); chan < kADCChannels; ++chan)
  {
    auto buffer = gSampleBuffers[chan];
    buffer.Clear();
  }
  digitalWrite(ledPin, LOW);
}

void sendFirstSampleTimeIfNeeded()
{
  if (!gFirstSampleTimeRequested)
    return;

  gFirstSampleTimeRequested = false;
  debugNewLine(); //Readability while testing only!

  FirstSampleTimePacket ftPacket(gFirstADCPointus);
  ftPacket.write(Serial);

  debugNewLine(); //Readability while testing only!
}

#ifdef ADC_TIMER

volatile uint16_t adc_val;

void adc0_isr()
{
  adc_val = (int16_t)ADC1_R0;
  int16_t iResult = adc_val;
  gSampleBuffers[0].Push(iResult);
  digitalWrite(outputTestPin, gUSBBPinState = !gUSBBPinState);
}

void adc1_isr()
{
  adc_val = (int16_t)ADC2_R0;
  int16_t iResult = adc_val;
  gSampleBuffers[1].Push(iResult);
  digitalWrite(outputTestPin, gUSBBPinState = !gUSBBPinState);
}

void doStart(int freq)
{
  adc->adc0->stopTimer();
  adc->adc0->startSingleRead(readPin1); // call this to setup everything before the Timer starts, differential is also possible
  adc->adc0->enableInterrupts(adc0_isr);
  adc->adc0->startTimer(freq); //frequency in Hz

  adc->adc1->stopTimer();
  adc->adc1->startSingleRead(readPin2);
  adc->adc1->enableInterrupts(adc1_isr);
  adc->adc1->startTimer(freq);
}

#endif // ADC_TIMER

void loop()
{
  int hasRx = Serial.peek();

  if (hasRx >= 0)
  {
    char cmdBuf[kMaxCommandLenBytes];
    Serial.readBytesUntil('\n', cmdBuf, kMaxCommandLenBytes);

    auto cmd = cmdBuf[0];

    // for examples of other device commands see SAMDLightning.ino
    switch (cmd)
    {
    case 'b': //begin sampling
      StartSampling();
      break;
    case 'f': //first sample time
      gFirstSampleTimeRequested = true;
      if (gState == kSampling)
        sendFirstSampleTimeIfNeeded();
      break;
    case 's': //stop sampling
      StopSampling();
      break;
    case 'v': //version info as JSON
      Serial.print("{");
      Serial.print("\"deviceClass\": \"Teensy_4\",");
      Serial.print("\"deviceName\": \"Teensy 4.1\",");
      Serial.print("\"version\": \"" + String(kFWVersion) + "\",");
      Serial.print("\"numberOfChannels\": " + String(kADCChannels) + ",");
      Serial.print("\"deviceSynchModes\": " + String(kDeviceSynchNone) + ",");
      Serial.print("\"serialNumber\": \"" + String(kSerialNumber) + "\"");
      Serial.print("}$$$");

      Packet::ResetPacketCount(); //new session

      break;
    // case '~': //sample rate
    // {
    //   auto rateChar = cmdBuf[1]; //'0123456'
    //   unsigned int index = rateChar - '0';
    //   if (index < sizeof(kSampleRates) / sizeof(int))
    //     gADCPointsPerSec = kSampleRates[index];
    //   if (gADCPointsPerSec > 100)
    //     gADCPointsPerPacket = kPointsPerMediumSizePacket;
    //   else
    //     gADCPointsPerPacket = kPointsPerPacket;

    //   break;
    // }
    default:
      break;
    }
  }

  if (gState == kIdle)
    return;

  if (gState == kHadFirstSample)
  {
    gState = kSampling;
    sendFirstSampleTimeIfNeeded();
  }

  //Find the number of samples in the ringbuffer with the least samples
  int points = gSampleBuffers[0].GetCount();
  for (int chan(1); chan < kADCChannels; ++chan)
  {
    auto &buffer = gSampleBuffers[chan];
    points = min(buffer.GetCount(), points); // on each loop run see if there is enough data in the buffer to create a packet
  }

  while (points >= gADCPointsPerPacket)
  {
    Packet packet;

    for (int pt(0); pt < gADCPointsPerPacket; ++pt)
    {
      for (int chan(0); chan < kADCChannels; ++chan)
      {
        auto &buffer = gSampleBuffers[chan];
        packet.addSample(chan, buffer.GetNext()); // getting the data out of the buffer into a packet. getNext bumps the mOut.
      }
      packet.nextPoint();
    }
    packet.write(Serial);
    --points;
  }

} //loop
