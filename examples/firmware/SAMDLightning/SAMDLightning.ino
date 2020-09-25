#include "src/Adafruit_ZeroTimer.h"

#define PHASE_LOCK_TO_USB_SOF 1
//#define OUTPUT_USB_SOF_PLL_SIGNALS 1
//#define ENABLE_DCO_TEST_COMMANDS 1

Adafruit_ZeroTimer adcTimer(4);


/* Valid PWM outs:

FOR SAMD21:
  Timer3: channel 0 on D2 or D10, channel 1 on D5 or D12
  Timer4: channel 0 on SDA or A1, channel 2 on SCL or A2
  Timer5: channel 0 on MOSI, channel 1 on SCK

FOR SAMD51:
  Timer3: channel 0 on D10 or MISO, channel 1 on D11
  Timer4: channel 0 on A4, D7, or D1, channel 2 on A5, D4, or D0
  Timer5: channel 0 on D5, channel 1 on D6
*/

#if defined(__SAMD51__)
#define TIMER3_OUT0 10
#define TIMER3_OUT1 11

#define TIMER4_OUT0 A4
#define TIMER4_OUT1 A5

#define TIMER5_OUT1 6
#else
#define TIMER3_OUT0 10
#define TIMER3_OUT1 12

#define TIMER4_OUT0 A1
#define TIMER4_OUT1 A2

#define TIMER5_OUT1 SCK
#endif

//#define ENABLE_ADCTIMER_PWMOUT 1

const int kDefaultADCPointsPerSec = 100; //~5000 max with 2 samples (1 point) per packet
int gADCPointsPerSec = kDefaultADCPointsPerSec; //~5000 max with 2 samples (1 point) per packet

const int kSampleRates[] = {10000, 4000, 2000, 1000, 400, 200, 100};
const int kNSampleRates = sizeof(kSampleRates)/sizeof(int);


const int kADCStartChan = 2; //A1
const int kADCChannels = 2; //must be power of 2 (for now)

const int kADCEndChan = kADCStartChan + kADCChannels;


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


inline void syncADC() 
{
  while (ADC->STATUS.bit.SYNCBUSY);
}

void startADCTimer(uint32_t frequency) 
{
/********************* Timer #4 + #5, 32 bit, one PWM out */
adcTimer.configure(TC_CLOCK_PRESCALER_DIV1, // prescaler
            TC_COUNTER_SIZE_32BIT,   // bit width of timer/counter
            TC_WAVE_GENERATION_MATCH_FREQ // frequency or PWM mode
            );
//adcTimer.setPeriodMatch(1000, 200);      // channel 1 only, 200/1000 count
adcTimer.setCompare(0, VARIANT_MCK/frequency - 1);
#ifdef ENABLE_ADCTIMER_PWMOUT
//N.B. this will be at half the rate of the ADC (i.e. each edge triggers a set of conversions across channels)
if (! adcTimer.PWMout(true, 0, TIMER4_OUT0)) {
   Serial.println("Failed to configure PWM output");
}
#endif

TC4->COUNT32.EVCTRL.reg |= TC_EVCTRL_MCEO0;
while (TC4->COUNT32.STATUS.bit.SYNCBUSY);                // Wait for synchronization

//adcTimer.enable(true);
}

void adc_setup()
{
   //Setup event system so TC4 triggers ADC conversion start
PM->APBCMASK.reg |= PM_APBCMASK_EVSYS;                                  // Switch on the event system peripheral

while(GCLK->STATUS.reg & GCLK_STATUS_SYNCBUSY);
GCLK->CLKCTRL.reg = GCLK_CLKCTRL_CLKEN |        // Enable the generic clock...
                      GCLK_CLKCTRL_GEN_GCLK0 |    // On GCLK0 at 48MHz
                      GCLK_CLKCTRL_ID( GCM_EVSYS_CHANNEL_0 );    // Route GCLK0 to EVENT channle

while (GCLK->STATUS.bit.SYNCBUSY);              // Wait for synchronization


EVSYS->USER.reg = EVSYS_USER_CHANNEL(1) |                               // Attach the event user (receiver) to channel 0 (n + 1)
                  EVSYS_USER_USER(EVSYS_ID_USER_ADC_START);             // Set the event user (receiver) as ADC START

EVSYS->CHANNEL.reg = EVSYS_CHANNEL_EDGSEL_NO_EVT_OUTPUT |               // No event edge detection
                     EVSYS_CHANNEL_PATH_ASYNCHRONOUS |                  // Set event path as asynchronous
                     EVSYS_CHANNEL_EVGEN(EVSYS_ID_GEN_TC4_MCX_0) |      // Set event generator (sender) as TC4 Match/Capture 0
                     EVSYS_CHANNEL_CHANNEL(0);                          // Attach the generator (sender) to channel 0                                 

//Setup ADC

analogReadResolution(12);
analogReference(AR_DEFAULT);

pinPeripheral(A1, PIO_ANALOG);
pinPeripheral(A2, PIO_ANALOG);

//ADC->INPUTCTRL.bit.INPUTOFFSET = kADCStartChan;
syncADC();
ADC->INPUTCTRL.bit.MUXPOS = kADCStartChan;
syncADC();
ADC->INPUTCTRL.bit.INPUTOFFSET = 0;
syncADC();
ADC->INPUTCTRL.bit.INPUTSCAN = 0;//kADCChannels-1;
syncADC();


//PM->APBCMASK.reg |= PM_APBCMASK_ADC; already done by wiring.c

//ADC->INPUTCTRL.reg
ADC->EVCTRL.reg = ADC_EVCTRL_STARTEI; //Start on event

ADC->INTENSET.reg = ADC_INTENSET_RESRDY; //Enable interrupt on result ready

syncADC();
ADC->CTRLA.bit.ENABLE = 0x01;             // Enable ADC
syncADC();

//NVIC_SetPriority(ADC_IRQn, 0);    // Set the Nested Vector Interrupt Controller (NVIC) priority for ADC to 0 (highest)

NVIC_EnableIRQ(ADC_IRQn);
}

template <class T, int Size>
class RingBufferSized
   {
   public:
      typedef int TIndex;

   RingBufferSized() : mIn(0),mOut(0)
      {
      }

   void Clear()
      {
      mOut = mIn;
      }

   TIndex GetCount() const
   {
   TIndex result = mIn-mOut;
   if(result < 0)
      result += Size;
   return result;
   }

   TIndex GetSpace() const
   {
   return (Size - 1) - GetCount();
   }

   bool Push(T val)
      {
      if(GetSpace())
         {
         mBuffer[mIn++] = val;
         if(mIn >= Size)
            mIn -= Size;
         return true;
         }
      return false;
      }

   //Returns num pushed
   int Push(const T *val, TIndex nToPushIn)
      {
      TIndex nToPushRemain = nToPushIn;
      TIndex space = GetSpace();

      if(nToPushRemain > space)
         nToPushRemain = space; //limit to available space
      else
         space = nToPushIn; //space is now number that will be pushed

      if(nToPushRemain)
         {//There is space
         TIndex lenToCopy1 = (Size-mIn); //space available before wrapping
         if(lenToCopy1 > nToPushRemain)
            lenToCopy1 = nToPushRemain;
         memcpy(mBuffer+mIn,val,lenToCopy1*sizeof(T));
         mIn += lenToCopy1;
         if(mIn >= Size)
            mIn -= Size;
         nToPushRemain -= lenToCopy1;
         if(nToPushRemain)
            {//still some left to copy, wrap to start of buffer
            memcpy(mBuffer,val+lenToCopy1,nToPushRemain*sizeof(T));
            mIn += nToPushRemain;
            if(mIn >= Size)
               mIn -= Size;
            }
         }
      return space; //Space is number pushed.
      }


   bool Get(T *val) const
      {
      if(GetCount())
         {
         *val = mBuffer[mOut];
         return true;
         }
      return false;
      }

   const T& Get() const
      {
      return mBuffer[mOut];
      }

   const T& GetNext()
      {
      const T& result = mBuffer[mOut++];
      if(mOut >= Size)
         mOut -= Size;
      return result;
      }

   bool GetNext(T *val)
      {
      if(GetCount())
         {
         *val = mBuffer[mOut++];
         if(mOut >= Size)
            mOut -= Size;
         return true;
         }
      return false;
      }

   bool NextOut()
      {
      if(GetCount())
         {
         mOut++;
         if(mOut >= Size)
            mOut -= Size;
         return true;
         }
      return false;
      }

   protected:
   T mBuffer[Size];
   volatile TIndex mIn;
   volatile TIndex mOut;
   };


const int kMaxCommandLenBytes = 64;

const int kBytesPerSample = sizeof(int16_t);

const int kPointsPerPacket = 1;
const int kPointsPerMediumSizePacket = 10;

int gADCPointsPerPacket = kPointsPerPacket;

//Statically allocating individual buffers larger than this causes the firmware to crash for some reason
#if defined(__SAMD51__)
const int kTotalBufferSpaceBytes = kADCChannels < 2 ? 32000 : 64000; 
#else
const int kTotalBufferSpaceBytes = 16*1024; //Largest buffer that works on SAMD21
#endif

const int kBufferPoints = kTotalBufferSpaceBytes/kBytesPerSample/kADCChannels;

typedef RingBufferSized<int16_t, kBufferPoints> TRingBuf;

TRingBuf gSampleBuffers[kADCChannels];


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


/**
 * Measured one fine step (133 to 134) to give a frequency offset of 5 parts in 10000
 * with the SAMD51.
 * Measured one coarse step to equal 12 fine steps. It was intially 29 out of 64 steps total.
*/
#if defined(__SAMD51__)
const int kDFLLFineMax = 127;
const int kDFLLFineMin = -128;
#else
const int kDFLLFineMax = 511;
const int kDFLLFineMin = -512;
#endif

extern "C" void UDD_Handler(void);

volatile int sLastFrameNumber = 0;
volatile int32_t gPrevFrameTick = -1;

volatile int gLastDCOControlVal = 0;

volatile bool gUSBBPinState = false;

const int kHighSpeedTimerTicksPerus = 4;
const int kHighSpeedTimerTicksPerUSBFrame = 1000*kHighSpeedTimerTicksPerus;

const int kOneOverLeadGainus = 1;   // 1/proportional gain

#if defined(__SAMD51__)
   const int kOneOverLagGainus = 4096; // 1/integral gain
   const int kOneOverClippedLeadGainus = 4; 
#else
   const int kOneOverLagGainus = 2048; // 1/integral gain
   const int kOneOverClippedLeadGainus = 1; 
#endif
const int kFixedPointScaling = kOneOverLagGainus*kHighSpeedTimerTicksPerus;

//Integrator for integral feedback to remove DC error
volatile int32_t sPSDPhaseAccum = 0;

//First order LPF for lead (proportional) feedback
volatile int32_t gLeadPhaseAccum = 0;
const int kLeadPhaseTC = 16;


extern "C"
{

void USBHandlerHook(void)
{
if(USB->DEVICE.INTFLAG.bit.SOF) //Start of USB Frame interrupt
   {
   digitalWrite(1, gUSBBPinState = !gUSBBPinState );
   //int32_t SOFtickus = micros();

   //Measure phase using Cortex cpu timer. Convert to 0.25 us ticks using a runtime multiply and compile time divides for speed.
   int32_t frameTick = ((SysTick->LOAD  - SysTick->VAL)*(kHighSpeedTimerTicksPerus*1024*1024/(VARIANT_MCK/1000000)))>>20;
   if(gState == kWaitingForUSBSOF)
      {
      adcTimer.enable(true);
      gState = kStartingSampling;
      }
   //frameus in range [0, 1000)
   //usbd.frameNumber();
   sLastFrameNumber = USB->DEVICE.FNUM.bit.FNUM;
   //if(gPrevFrameTick >= 0)
      {
      int phase = frameTick;
      //phase needs to be bipolar, so wrap values above kHighSpeedTimerTicksPerUSBFrame/2 to be -ve. We want to lock with frameHSTick near 0.
      if(phase >= kHighSpeedTimerTicksPerUSBFrame/2)
         phase -= kHighSpeedTimerTicksPerUSBFrame;

      //First order LPF for lead (proportional) feedback (LPF to reduce the effects of phase detector noise)
      gLeadPhaseAccum += phase;
      int leadPhase = gLeadPhaseAccum/kLeadPhaseTC;
      gLeadPhaseAccum -= leadPhase;

      //Unfiltered lead feedback clipped to +/- 1 to reduce the effects of phase detector noise without adding delay
      int signOfPhase = 0;
      if(phase > 0)
         signOfPhase = 1;
      else if(phase < 0)
        signOfPhase = -1;

      //Calculate the filtered error signal
      int32_t filterOut = (signOfPhase*kFixedPointScaling/kOneOverClippedLeadGainus + 
         leadPhase*kFixedPointScaling/(kOneOverLeadGainus*kHighSpeedTimerTicksPerus) + 
         sPSDPhaseAccum)/kFixedPointScaling;
      sPSDPhaseAccum += phase; //integrate the phase to get lag (integral, 2nd order) feedback

      //Clip to limits of DCO
      if(filterOut > kDFLLFineMax)
         filterOut = kDFLLFineMax;
      else if(filterOut < kDFLLFineMin)
         filterOut = kDFLLFineMin;

      int32_t newDCOControlVal = kDFLLFineMax - filterOut;

      gLastDCOControlVal = newDCOControlVal;

      //Set DCO control value
      #ifdef PHASE_LOCK_TO_USB_SOF
      #if defined(__SAMD51__)
      OSCCTRL->DFLLVAL.bit.FINE = newDCOControlVal & 0xff;
      #else
      //SAMD21 has 10 bit fine DCO control
      SYSCTRL->DFLLVAL.bit.FINE = newDCOControlVal & 0x3ff;
      #endif
      #endif
      }
   gPrevFrameTick = frameTick;

   }
UDD_Handler();
}

} //extern "C"


void setup() 
{
auto irqState = saveIRQState();

//Turn off frequency locking closed loop mode
#if defined(__SAMD51__)
OSCCTRL->DFLLCTRLB.reg &= ~OSCCTRL_DFLLCTRLB_MODE;
#else
//SAMD21
SYSCTRL->DFLLCTRL.reg &= ~SYSCTRL_DFLLCTRL_MODE;
#endif

USB_SetHandler(&USBHandlerHook);
restoreIRQState(irqState);

Serial.begin (0);
while(!Serial);

pinMode(6, OUTPUT); //Test only - toggles on each ADC_Handler()
pinMode(LED_BUILTIN, OUTPUT);
digitalWrite(LED_BUILTIN, LOW); 


adc_setup();
startADCTimer(gADCPointsPerSec);
}



void ADC_Handler(void)
{
int val = ADC->RESULT.reg;

syncADC();
int chan = ADC->INPUTCTRL.bit.MUXPOS;
syncADC();

#ifdef OUTPUT_USB_SOF_PLL_SIGNALS
if(chan - kADCStartChan == 0)
   {
   //val = gLastBit;
   //gLastBit = 1-gLastBit;
   val = gPrevFrameTick;
   if(val >= kHighSpeedTimerTicksPerUSBFrame/2)
      val -= kHighSpeedTimerTicksPerUSBFrame;
   }
else if(chan - kADCStartChan == 1)
   {
   val = gLastDCOControlVal;//OSCCTRL->DFLLVAL.bit.FINE;
   }
val += 2048;
#endif


if(!gSampleBuffers[chan-kADCStartChan].Push(val))
   digitalWrite(LED_BUILTIN, LOW); //Turn off LED to indicate overflow

if(chan == kADCStartChan && gState == kStartingSampling)
   {
   gFirstADCPointus = micros();
   gState = kHadFirstSample;   
   }

syncADC();
if(++chan < kADCEndChan)
   {
   ADC->INPUTCTRL.bit.MUXPOS = chan;      
   syncADC();
   ADC->SWTRIG.bit.START = 1;
   }
else
   {
   ADC->INPUTCTRL.bit.MUXPOS = kADCStartChan;
   }

syncADC();
//digitalWrite(6, gADCstate = !gADCstate );  
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
   const char sHeader[2] = {'P',0xA0};

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
      if(mPoint >= gADCPointsPerPacket)
         return false;
//Testing!!
//if(chan == 0)
//   mData[mPoint][chan] = 0;
//else
      mData[mPoint][chan] = (sample << 4) - 0x8000;

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
      n += stream.write(uint8_t(gADCPointsPerPacket==1?'D':'M'));
      n += stream.write(sPacketCount++);
      n += stream.write(reinterpret_cast<const uint8_t*>(mData), sizeof(int16_t)*kADCChannels*gADCPointsPerPacket);
      return n;
      }


protected:

   int mPoint;
   int16_t mData[kPointsPerMediumSizePacket][kADCChannels];

};



class TimePacket : protected PacketBase
{
   const char sHeaderAndPacketType[3] = {'P',0xA0,'N'}; //'N' for now

public:
   TimePacket(int32_t tick32us, uint8_t timeRequestNumber) :
      mTimeRequestNumber(timeRequestNumber)
      {
      mData[0] = tick32us;
      }

      //returns number of bytes written
   int write(Stream &stream) const
      {
      int n = stream.write(sHeaderAndPacketType, 3);
      n += stream.write(sPacketCount++);
      n += stream.write(mTimeRequestNumber);
      n += stream.write(reinterpret_cast<const uint8_t*>(mData), sizeof(mData));
      return n;
      }

protected:

   int32_t mData[1];
   uint8_t mTimeRequestNumber;
};

class FirstSampleTimePacket : protected PacketBase
{
   const char sHeaderAndPacketType[3] = {'P',0xA0,'F'}; //'F' for First sample time

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
      n += stream.write(reinterpret_cast<const uint8_t*>(mData), sizeof(mData));
      return n;
      }

protected:

   int32_t mData[1];
};


void StartSampling()
{
adcTimer.enable(false);
NVIC_DisableIRQ(ADC_IRQn);
NVIC_ClearPendingIRQ(ADC_IRQn);

adc_setup();

//Restart the ADC timer
startADCTimer(gADCPointsPerSec);

for(int chan(0); chan<kADCChannels;++chan)
   {
   auto &buffer = gSampleBuffers[chan];
   buffer.Clear();
   }

//digitalWrite(12, LOW); //Clear Buffer overflow
//Packet::ResetPacketCount();
gState = kWaitingForUSBSOF;

digitalWrite(LED_BUILTIN, HIGH);
}

void StopSampling()
{
gState = kIdle;
gFirstSampleTimeRequested = false;

for(int chan(0); chan<kADCChannels;++chan)
   {
   auto buffer = gSampleBuffers[chan];
   buffer.Clear();
   }
digitalWrite(LED_BUILTIN, LOW);   
}


void sendFirstSampleTimeIfNeeded()
{
if(!gFirstSampleTimeRequested)
   return;

gFirstSampleTimeRequested = false;
debugNewLine();   //Readability while testing only!

FirstSampleTimePacket ftPacket(gFirstADCPointus);
ftPacket.write(Serial);

debugNewLine();   //Readability while testing only!
}


void loop()
{
int hasRx = Serial.peek();

if(hasRx >= 0)
   {
   char cmdBuf[kMaxCommandLenBytes];
   int bytesRead = Serial.readBytesUntil('\n', cmdBuf, kMaxCommandLenBytes);
   #ifdef ENABLE_SERIAL_DEBUGGING
   SerialUSB.println("bytesRead="+String(bytesRead));
   SerialUSB.println(cmdBuf[0], HEX);
   SerialUSB.println(cmdBuf[1], HEX);
   SerialUSB.println();
   #endif
   auto cmd = cmdBuf[0];
   switch (cmd)
      {
      case 'b':   //begin sampling
         StartSampling();
         break;
      case 'f':   //first sample time
         gFirstSampleTimeRequested = true;
         if(gState == kSampling)
            sendFirstSampleTimeIfNeeded();
         break;

      #ifdef ENABLE_DCO_TEST_COMMANDS
      case 'D':
         {
         int coarseFreq = SYSCTRL->DFLLVAL.bit.COARSE;
         SYSCTRL->DFLLVAL.bit.COARSE = --coarseFreq;
         Serial.println("DFLL coarse ="+String(coarseFreq));
         break;
         }
      case 'I':
         {
         int coarseFreq = SYSCTRL->DFLLVAL.bit.COARSE;
         SYSCTRL->DFLLVAL.bit.COARSE = ++coarseFreq;
         Serial.println("DFLL coarse ="+String(coarseFreq));
         break;
         }
      case 'd':
         {
         int fineFreq = SYSCTRL->DFLLVAL.bit.FINE;
         SYSCTRL->DFLLVAL.bit.FINE = --fineFreq;
         Serial.println("DFLL fine ="+String(fineFreq));
         break;
         }
      case 'i':
         {
         int fineFreq = SYSCTRL->DFLLVAL.bit.FINE;
         SYSCTRL->DFLLVAL.bit.FINE = ++fineFreq;
         Serial.println("DFLL fine ="+String(fineFreq));
         break;
         }
      #endif

      case 's':   //stop sampling
         StopSampling();
         break;
      case 'n':   //return micro second time now
         {
         int32_t now = micros();
         //uint64_t now64 = micros64();
         //digitalWrite(5, HIGH);

         auto timeRequestNumber = cmdBuf[1];
         TimePacket timePacket(now, timeRequestNumber);
         timePacket.write(Serial);

         //digitalWrite(5, LOW);

         break;   
         }
      case 'v':   //version info
         Serial.print("ArduinoRT Example V0.9.0 Channels: "+String(kADCChannels)+" $$$");
         Packet::ResetPacketCount(); //new session

         #ifdef ENABLE_SERIAL_DEBUGGING
         SerialUSB.println("Sent version info");
         #endif
         break;
      case '~': //sample rate
         {
         auto rateChar = cmdBuf[1]; //'0123456'
         unsigned int index = rateChar - '0';
         if(index < sizeof(kSampleRates)/sizeof(int))
            gADCPointsPerSec = kSampleRates[index];
         if(gADCPointsPerSec > 100)
            gADCPointsPerPacket = kPointsPerMediumSizePacket;
         else
            gADCPointsPerPacket = kPointsPerPacket;

         break;
         }
      default:
         break;
      }

   }

if(gState == kIdle)
   return;

if(gState == kHadFirstSample)
   {
   gState = kSampling;
   sendFirstSampleTimeIfNeeded();
   }

//Find the number of samples in the ringbuffer with the least samples
int points = gSampleBuffers[0].GetCount();
for(int chan(1); chan<kADCChannels;++chan)
   {
   auto &buffer = gSampleBuffers[chan];
   points = min(buffer.GetCount(), points);
   }


while(points >= gADCPointsPerPacket)
   {
   Packet packet;

   for(int pt(0);pt<gADCPointsPerPacket;++pt)
      {
      for(int chan(0); chan<kADCChannels;++chan)
         {
         auto &buffer = gSampleBuffers[chan];
         packet.addSample(chan, buffer.GetNext());
         }
      packet.nextPoint();
      }

   //digitalWrite(7, HIGH);
   packet.write(Serial);
   //digitalWrite(7, LOW);

   --points;

   //debugNewLine();   //Readability while testing only!
   }

}//loop