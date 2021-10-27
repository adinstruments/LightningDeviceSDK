int LEDpin = 5 ;
int PWMpin = 19 ;

#include <ADC.h>
#include <ADC_util.h>

const int readPin = A0; // ADC0

ADC *adc = new ADC(); // adc object;

void setup() {
  pinMode(LEDpin, OUTPUT);
  pinMode(readPin, INPUT);

  Serial.begin(9600);
  while (!Serial && millis() < 5000) ; // wait up to 5 seconds for serial monitor.
  Serial.println("begin setup");

 boolean withPWM=true ;
  if(withPWM){
    analogWriteRes(10);
    analogWriteFrequency(PWMpin,1000000);
    analogWrite(PWMpin, 512);
    }

  
  ///// ADC0 ////
  adc->adc0->setAveraging(1); // set number of averages
  adc->adc0->setResolution(10); // set bits of resolution
  adc->adc0->setConversionSpeed(ADC_CONVERSION_SPEED::VERY_HIGH_SPEED); // change the conversion speed
  adc->adc0->setSamplingSpeed(ADC_SAMPLING_SPEED::VERY_HIGH_SPEED); // change the sampling speed
  doStart(500000) ;
  Serial.println("End setup");
}

 void doStart(int freq){
  Serial.print("Start Timer with frequency ");
  Serial.print(freq);
  Serial.println(" Hz.");
  adc->adc0->stopTimer();
  adc->adc0->startSingleRead(readPin); // call this to setup everything before the Timer starts, differential is also possible
  adc->adc0->enableInterrupts(adc0_isr);
  adc->adc0->startTimer(freq); //frequency in Hz
  }

volatile uint16_t adc_val ;

void loop() {
   Serial.printf("ADCval=%8d\n",adc_val);
   delay(1000) ;
   }

void adc0_isr() {
  CORE_PIN5_PORTSET = CORE_PIN5_BITMASK; // debug pin=high
  adc_val = (int16_t)ADC1_R0;
  analogWrite(PWMpin, adc_val);
  CORE_PIN5_PORTCLEAR = CORE_PIN5_BITMASK; // debug pin=low
  #if defined(__IMXRT1062__)  // Teensy 4.0
  asm("DSB");
#endif
}