export const nanoErrorArray = [
   ['NoError', ''],
   ['GeneralError', ''],
   [
      'LedContr_erro_LowControlVolt',
      'Please check the wrist unit and restart the device.'
   ],
   [
      'LedContr_erro_HighControlVolt',
      'Unable to set correct LED current. Please inspect your hardware configuration.'
   ],
   [
      'LedContr_erro_HighLedCurrent',
      'Unable to set correct LED current. Please inspect your hardware configuration.'
   ],
   [
      'LedContr_erro_TooManyIteratio',
      'Unable to set correct LED current. Please inspect your hardware configuration.'
   ],
   [
      'LedContr_erro_CurrBelowDrift',
      'Finger cuff (or cuff cable) loose or not connected.'
   ],
   [
      'LedContr_erro_CurrAboveDrift',
      'Unable to set correct LED current. Please inspect your hardware configuration.'
   ],
   [
      'LedContr_erro_VoltBelowRange',
      'Unable to set correct LED current. Please inspect your hardware configuration.'
   ],
   [
      'LedContr_erro_VoltAboveRange',
      'Unable to set correct LED current. Please inspect your hardware configuration.'
   ],
   [
      'Plethysm_erro_TooMuchLight',
      'The infrared level transmitted through the finger is too high. Try a smaller finger cuff.'
   ],
   [
      'PhysScan_erro_SyncBeatTimeOut',
      'Odd plethysmogram detected, probably due to pressing the cuff or finger-tip.'
   ],
   [
      'PhysScan_erro_ScanFailed',
      'No blood pressure signal. May be: finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'PhysScan_erro_BeatDownTimeOut',
      'No plethysmogram detected. Check proper application of the finger cuff.'
   ],
   [
      'PresMoni_erro_IncorrectPress',
      'Cuff pressure error. Please check the cuff air hose.'
   ],
   [
      'PresMoni_erro_UnstablePress',
      'Cuff pressure unstable. Please check the cuff air hose.'
   ],
   [
      'ManoBeDe_erro_PressTooLow',
      'Cuff pressure too low. Please check the cuff air hose.'
   ],
   [
      'SignInMo_erro_MeanPressLow',
      'Mean pressure has been below 10mmHg for 2.5s. Please check the cuff air hose.'
   ],
   [
      'SignInMo_erro_UnacceptableP',
      'The plethysmogram values moved out of range. This may be a movement artifact.'
   ],
   [
      'SignInMo_erro_MeanPressHigh',
      'Mean pressure has been above 250 mmHg for 2.5s. Please check the cuff air hose.'
   ],
   [
      'PreContr_erro_CuffPreSensRang',
      'Cuff pressure sensor out of range. Check if the finger cuff is wrapped tight enough around the finger.'
   ],
   [
      'PreContr_erro_VolPreSensRang',
      'Volume pressure sensor out of range. Please check the cuff air hose.'
   ],
   [
      'PreContr_erro_CuffPreExceed',
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'PreContr_erro_CuffPreExceLong',
      'Mean pressure has been above 250 mmHg for 2.5s. Please check the cuff air hose.'
   ],
   [
      'PreContr_erro_VolPreExceed',
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'PreContr_erro_CurrExceedLong',
      'Current exceeded for too long. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_VoltageSenseFailure',
      'One of the internal voltages being monitored has failed. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_HcuRefSenseFailure',
      'Monitoring the reference voltage of the HCU has failed. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_PletRefSenseFailure',
      'Plethysmograph reference monitor failed. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_HouseTempSenseFailure',
      'Housing temperature sensor error. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_cuffPressureSenseFailure',
      'Cuff pressure sensor failure. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_volumePressureSenseFailure',
      'Cuff pressure sensor failure. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_VoltageOutLimits',
      'Supply voltage error. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_HcuRefOutLimits',
      'Plethysmograph ref out of limits. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_PletRefOutLimits',
      'Plethysmograph ref out of limits. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_cuffPressureSignalOffset',
      'Pressure signal offset too large. Please restart the wrist unit by reconnecting to HNIBP interface.'
   ],
   [
      'SysIntgr_erro_volumePressureSignalOffset',
      'Pressure signal offset too large. Please keep the wrist unit stable during its start-up.'
   ],
   [
      'SysIntgr_erro_pressureSensorTimeout',
      'Plethysmograph ref out of limits. Please keep the wrist unit stable during its start-up.'
   ],
   //Empty entry to match typo in the manual where one number is missing
   ['', ''],
   [
      'AppContr_erro_PressureToHigh',
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.'
   ],
   [
      'AppContr_erro_caseTemperatureOutLimits',
      'The housing of the wrist unit is too hot. Please check convection possibilities around the wrist unit.'
   ],
   [
      'AppContr_erro_pcbTemperatureOutLimits',
      'The processor of the wrist unit is too hot. Please check convection possibilities around the wrist unit.'
   ],
   [
      'AppContr_erro_MeasurementToLong',
      'The maximum time of 4 hours for measuring on a single cuff has exceeded. Please switch to another cuff.'
   ],
   [
      'HcuContr_erro_hcuOffsetToBig',
      'HCU offset too large. Please retry zeroing.'
   ],
   [
      'HcuContr_erro_NotAllowed',
      'HCU can not be zeroed during sampling. Please stop recording if HCU zeroing is needed.'
   ],
   [
      'AppContr_erro_KeepAliveNotReceived',
      'The Keep Alive package has not been received in time from LabChart. Please check cables and restart the device and LabChart.'
   ],
   ['Driver_erro_SensorFailed', 'Driver_erro_SensorFailed']
];

type FrozenObject<T> = Readonly<{
   [key: string]: T;
}>;

export const nanoWarningsArray: FrozenObject<string> = Object.freeze({
   0x00000000: 'NoWarning',
   0x00000001: 'GeneralWarning',
   0x00000004: 'PhysScan_warn_NewScanWithAHB',
   0x00000008: 'PhysAdju_warn_BeatUpTimeOut',
   0x00000010: 'PhysAdju_warn_BeatDownTimeOut',
   0x00000020: 'ManoBeDe_warn_PulseVeryLow',
   0x00000040: 'ManoBeDe_warn_NoPulse',
   0x00000080: 'SignInMo_warn_DecreasePletSp',
   0x00000100: 'OsciCont_warn_DecreasePletSp',
   0x00000200: 'PreContr_warn_BadStart',
   0x00000400: 'PreContr_warn_I2T_Protection',
   0x00000800: 'PreContr_warn_HighCurrent',
   0x00001000: 'PreContr_warn_PlungerPosEnd',
   0x00002000: 'PreContr_warn_TrackingError',
   0x00004000: 'PreContr_warn_PowerLimi',
   0x00008000: 'SysIntgr_warn_PressureSensorTrend',
   0x00010000: 'AppContr_warn_MeasurementLong',
   0x00020000: 'ModFlow_warn_BraCalLong',
   0x00040000: 'ModFlow_warn_BraCalLongAborted'
});

export const kManoBeDe_warn_NoPulse = 0x80000020;
