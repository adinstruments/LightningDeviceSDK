#include "src/Adafruit_ZeroTimer.h"

Adafruit_ZeroTimer adcTimer(4);

#ifdef TIMER_OUTPUT_FOR_TEST
Adafruit_ZeroTimer zt3(3); //Testing
#endif

/* Valid PWM outs (for Adafruit Feather ):

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
//#define TIMING_CHECK 1

#ifdef TIMING_CHECK
const int kDefaultADCPointsPerSec = 1;//1024;//100; //~5000 max with 2 samples (1 point) per packet
#else
const int kDefaultADCPointsPerSec = 100; //~5000 max with 2 samples (1 point) per packet
#endif

int gADCPointsPerSec = kDefaultADCPointsPerSec; //~5000 max with 2 samples (1 point) per packet

const int kSampleRates[] = {4000, 2000, 1000, 400, 200, 100};
const int kNSampleRates = sizeof(kSampleRates)/sizeof(int);

const int kADCStartChan = 2; //A1

#ifdef TIMING_CHECK
const int kADCChannels = 1;//2; 
#else
const int kADCChannels = 2; 
#endif

const int kADCEndChan = kADCStartChan + kADCChannels;

 
void debugNewLine()
{
//Serial.write('\n'); //Readability while testing only!
}


inline void syncADC0_ENABLE() 
{
  while (ADC0->SYNCBUSY.reg & ADC_SYNCBUSY_ENABLE);
}

inline void syncADC0_CTRLB() 
{
  while (ADC0->SYNCBUSY.reg & ADC_SYNCBUSY_CTRLB);
}

inline void syncADC0_SAMPCTRL() 
{
  while (ADC0->SYNCBUSY.reg & ADC_SYNCBUSY_SAMPCTRL);
}

inline void syncADC0_INPUTCTRL() 
{
  while (ADC0->SYNCBUSY.reg & ADC_SYNCBUSY_INPUTCTRL);
}

inline void syncADC0_SWTRIG() 
{
  while (ADC0->SYNCBUSY.reg & ADC_SYNCBUSY_SWTRIG);
}

void startADCTimer(uint32_t frequency) 
{
/********************* Timer #4 + #5, 32 bit, one PWM out */
adcTimer.configure(TC_CLOCK_PRESCALER_DIV1, // prescaler
            TC_COUNTER_SIZE_32BIT,   // bit width of timer/counter
            TC_WAVE_GENERATION_MATCH_FREQ // frequency or PWM mode
            );
//adcTimer.setPeriodMatch(1000, 200);      // channel 1 only, 200/1000 count
//Adafruit timer routines set the timer source to GCLK1 (48 MHz)
adcTimer.setCompare(0, VARIANT_GCLK1_FREQ/frequency - 1);
#ifdef ENABLE_ADCTIMER_PWMOUT
//N.B. this will be at half the rate of the ADC (i.e. each edge triggers a set of conversions across channels)
if (! adcTimer.PWMout(true, 0, TIMER4_OUT0)) {
   Serial.println("Failed to configure PWM output");
}
#endif

TC4->COUNT32.EVCTRL.reg |= TC_EVCTRL_MCEO0;
while (TC4->COUNT32.SYNCBUSY.reg > 0);                // Wait for synchronization

//Setup Event system
MCLK->APBBMASK.reg |= MCLK_APBBMASK_EVSYS;

  // Select the event system user on channel 0 (USER number = channel number + 1)
EVSYS->USER[EVSYS_ID_USER_ADC0_START].reg = EVSYS_USER_CHANNEL(1);         // Set the event user (receiver) as timer TC0

// EVSYS->CHANNEL.reg = EVSYS_CHANNEL_EDGSEL_NO_EVT_OUTPUT |               // No event edge detection
//                      EVSYS_CHANNEL_PATH_ASYNCHRONOUS |                  // Set event path as asynchronous
//                      EVSYS_CHANNEL_EVGEN(EVSYS_ID_GEN_TC4_MCX_0) |      // Set event generator (sender) as TC4 Match/Capture 0
//                      EVSYS_CHANNEL_CHANNEL(0);                          // Attach the generator (sender) to channel 0                                 

EVSYS->Channel[0].CHANNEL.reg = EVSYS_CHANNEL_EDGSEL_NO_EVT_OUTPUT |               // No event edge detection
                     EVSYS_CHANNEL_PATH_ASYNCHRONOUS |                  // Set event path as asynchronous
                     EVSYS_CHANNEL_EVGEN(EVSYS_ID_GEN_TC4_MCX_0);        // Set event generator (sender) as TC4 Match/Capture 0

adcTimer.enable(true);
}

void adc_setup()
{
   //Setup event system so TC4 triggers ADC conversion start
//PM->APBCMASK.reg |= PM_APBCMASK_EVSYS;                                  // Switch on the event system peripheral

// while(GCLK->SYNCBUSY.reg & GCLK_STATUS_SYNCBUSY);
// GCLK->CLKCTRL.reg = GCLK_CLKCTRL_CLKEN |        // Enable the generic clock...
//                       GCLK_CLKCTRL_GEN_GCLK0 |    // On GCLK0 at 48MHz
//                       GCLK_CLKCTRL_ID( GCM_EVSYS_CHANNEL_0 );    // Route GCLK0 to EVENT channel

// while (GCLK->STATUS.bit.SYNCBUSY);              // Wait for synchronization


// EVSYS->USER.reg = EVSYS_USER_CHANNEL(1) |                               // Attach the event user (receiver) to channel 0 (n + 1)
//                   EVSYS_USER_USER(EVSYS_ID_USER_ADC_START);             // Set the event user (receiver) as ADC START

// EVSYS->CHANNEL.reg = EVSYS_CHANNEL_EDGSEL_NO_EVT_OUTPUT |               // No event edge detection
//                      EVSYS_CHANNEL_PATH_ASYNCHRONOUS |                  // Set event path as asynchronous
//                      EVSYS_CHANNEL_EVGEN(EVSYS_ID_GEN_TC4_MCX_0) |      // Set event generator (sender) as TC4 Match/Capture 0
//                      EVSYS_CHANNEL_CHANNEL(0);                          // Attach the generator (sender) to channel 0                                 

//Setup ADC

analogReadResolution(12);
analogReference(AR_DEFAULT);

pinPeripheral(A1, PIO_ANALOG);
pinPeripheral(A2, PIO_ANALOG);

//ADC->INPUTCTRL.bit.INPUTOFFSET = kADCStartChan;
ADC0->INPUTCTRL.bit.MUXPOS = kADCStartChan;
syncADC0_INPUTCTRL();
// ADC0->INPUTCTRL.bit.INPUTOFFSET = 0;
// syncADC0_INPUTCTRL();
// ADC0->INPUTCTRL.bit.INPUTSCAN = 0;//kADCChannels-1;
// syncADC0_INPUTCTRL();


//PM->APBCMASK.reg |= PM_APBCMASK_ADC; already done by wiring.c

//ADC->INPUTCTRL.reg
ADC0->EVCTRL.reg = ADC_EVCTRL_STARTEI; //Start on event

ADC0->INTENSET.reg = ADC_INTENSET_RESRDY; //Enable interrupt on result ready

ADC0->CTRLA.bit.ENABLE = 1;             // Enable ADC
syncADC0_ENABLE();

//NVIC_SetPriority(ADC_IRQn, 0);    // Set the Nested Vector Interrupt Controller (NVIC) priority for ADC to 0 (highest)

NVIC_EnableIRQ(ADC0_1_IRQn);
}

template <class T, unsigned int Log2Size>
class RingBufferSized
   {
   public:
      enum
      {
      kBufSize = 1<<Log2Size,
      kLenMask = kBufSize-1,
      };

   RingBufferSized() : mIn(0),mOut(0)
      {
      }

   void Clear()
      {
      mOut = mIn;
      }

   int GetCount() const
   {
   return (mIn-mOut) & kLenMask;
   }

   int GetSpace() const
   {
   return kLenMask - GetCount();
   }

   bool Push(T val)
      {
      if(GetSpace())
         {
         mBuffer[mIn++] = val;
         mIn &= kLenMask;
         return true;
         }
      return false;
      }

   //Returns num pushed
   int Push(const T *val, int nToPushIn)
      {
      int nToPushRemain = nToPushIn;
      int space = GetSpace();

      if(nToPushRemain > space)
         nToPushRemain = space; //limit to available space
      else
         space = nToPushIn; //space is now number that will be pushed

      if(nToPushRemain)
         {//There is space
         int lenToCopy1 = (kBufSize-mIn); //space available before wrapping
         if(lenToCopy1 > nToPushRemain)
            lenToCopy1 = nToPushRemain;
         memcpy(mBuffer+mIn,val,lenToCopy1*sizeof(T));
         mIn += lenToCopy1;
         mIn &= kLenMask;
         nToPushRemain -= lenToCopy1;
         if(nToPushRemain)
            {//still some left to copy, wrap to start of buffer
            memcpy(mBuffer,val+lenToCopy1,nToPushRemain*sizeof(T));
            mIn += nToPushRemain;
            mIn &= kLenMask;
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
      mOut &= kLenMask;
      return result;
      }

   bool GetNext(T *val)
      {
      if(GetCount())
         {
         *val = mBuffer[mOut++];
         mOut &= kLenMask;
         return true;
         }
      return false;
      }

   bool NextOut()
      {
      if(GetCount())
         {
         mOut++;
         mOut &= kLenMask;
         return true;
         }
      return false;
      }

   protected:
   T mBuffer[kBufSize];
   volatile int mIn;
   volatile int mOut;
   };

const int kMaxCommandLenBytes = 64;

const int kBytesPerSample = sizeof(int16_t);

const int kLog2BufferPoints = 13;
const int kBufferSizeBytes = (1 << kLog2BufferPoints)*kADCChannels*kBytesPerSample;

const int kPointsPerPacket = 1;
const int kPointsPerMediumSizePacket = 10;

const int kLog2BufferSizeBytes = 15;
const int kLog2ADCChannels = 1;
const int kLog2BytesPerSample = 1;

int gADCPointsPerPacket = kPointsPerPacket;

typedef RingBufferSized<int16_t, kLog2BufferPoints> TRingBuf;

TRingBuf gSampleBuffers[kADCChannels];


volatile int32_t gFirstADCPointus = 0;


enum State
{
kIdle,
kStartingSampling,
kHadFirstSample,
kSampling,  
};

volatile State gState = kIdle;
volatile bool gFirstSampleTimeRequested = false;

volatile bool gADCstate = false;

void setup() 
{
Serial.begin (0);
while(!Serial);

pinMode(6, OUTPUT); //Test only - toggles on each ADC_Handler()
pinMode(LED_BUILTIN, OUTPUT);
digitalWrite(LED_BUILTIN, LOW); 

#ifdef TIMER_OUTPUT_FOR_TEST
  /********************* Timer #3, 16 bit, one PWM out, period = 1024 */
  zt3.configure(TC_CLOCK_PRESCALER_DIV1, // prescaler
                TC_COUNTER_SIZE_16BIT,   // bit width of timer/counter
                TC_WAVE_GENERATION_MATCH_PWM // frequency or PWM mode
                );
  const uint32_t kTicks = VARIANT_GCLK1_FREQ/1024;
  zt3.setPeriodMatch(kTicks - 1, kTicks/4);      // channel 1 only, 200/1000 count
  if (! zt3.PWMout(true, 1, TIMER3_OUT1)) {
    Serial.println("Failed to configure PWM output");
  }

#ifdef _VARIANT_SAMD51_THING_PLUS_
//Sparkfun Thing Plus has different pin mapping from Adafruit Feather M4
PORT->Group[0].PINCFG[15].reg = PORT_PINCFG_PMUXEN; //PA15
PORT->Group[0].PMUX[7].reg &= ~(PORT_PMUX_PMUXO_Msk);
PORT->Group[0].PMUX[7].reg |= 0x04 << 4;//   PORT_PMUX_PMUXO_E;
#endif
//  PORT->Group[g_APinDescription[ulPin].ulPort].DIRSET.reg = (uint32_t)(1<<g_APinDescription[ulPin].ulPin) ;

  zt3.enable(true);
/*********************************************/

#endif


adc_setup();
startADCTimer(gADCPointsPerSec);
}

#ifdef TIMING_CHECK
volatile int32_t gLastADCus = 0;
int32_t gLastLastADCus = 0;
#endif

void ADC0_1_Handler()
{
#ifdef TIMING_CHECK
gLastADCus = micros();
#endif
digitalWrite(6, gADCstate = !gADCstate );  

int val = ADC0->RESULT.reg;

syncADC0_INPUTCTRL();
int chan = ADC0->INPUTCTRL.bit.MUXPOS;

if(!gSampleBuffers[chan-kADCStartChan].Push(val))
   digitalWrite(LED_BUILTIN, LOW); //Turn off LED to indicate overflow

if(chan == kADCStartChan && gState == kStartingSampling)
   {
   gFirstADCPointus = micros();
   gState = kHadFirstSample;   
   }

if(++chan < kADCEndChan)
   {
   ADC0->INPUTCTRL.bit.MUXPOS = chan;  
   syncADC0_INPUTCTRL();  
     
   ADC0->SWTRIG.bit.START = 1;
   syncADC0_SWTRIG();
   }
else
   {
   ADC0->INPUTCTRL.bit.MUXPOS = kADCStartChan;
   syncADC0_INPUTCTRL();
   }

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
NVIC_DisableIRQ(ADC0_1_IRQn);
NVIC_ClearPendingIRQ(ADC0_1_IRQn);

for(int chan(0); chan<kADCChannels;++chan)
   {
   auto &buffer = gSampleBuffers[chan];
   buffer.Clear();
   }

adc_setup();

//Restart the ADC timer
startADCTimer(gADCPointsPerSec);


//digitalWrite(12, LOW); //Clear Buffer overflow
//Packet::ResetPacketCount();
gState = kStartingSampling;

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
#ifdef TIMING_CHECK
int32_t delta = gLastADCus - gLastLastADCus;
if(delta > 0)
   {
   Serial.println("  delta = "+ String(delta));
   gLastLastADCus = gLastADCus;
   }
#endif

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
         Serial.write("ArduinoRT Example V0.9.0 $$$");
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