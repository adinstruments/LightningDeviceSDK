// Explictly state the error codes even though
// they increment normally (except for 38)
// prettier-ignore
export enum NIBPErrorCodes {
   NoError                                      = 0,
   GeneralError                                 = 1,
   LedContr_erro_LowControlVolt                 = 2,
   LedContr_erro_HighControlVolt                = 3,
   LedContr_erro_HighLedCurrent                 = 4,
   LedContr_erro_TooManyIteratio                = 5,
   LedContr_erro_CurrBelowDrift                 = 6,
   LedContr_erro_CurrAboveDrift                 = 7,
   LedContr_erro_VoltBelowRange                 = 8,
   LedContr_erro_VoltAboveRange                 = 9,
   Plethysm_erro_TooMuchLight                   = 10,
   PhysScan_erro_SyncBeatTimeOut                = 11,
   PhysScan_erro_ScanFailed                     = 12,
   PhysScan_erro_BeatDownTimeOut                = 13,
   PresMoni_erro_IncorrectPress                 = 14,
   PresMoni_erro_UnstablePress                  = 15,
   ManoBeDe_erro_PressTooLow                    = 16,
   SignInMo_erro_MeanPressLow                   = 17,
   SignInMo_erro_UnacceptableP                  = 18,
   SignInMo_erro_MeanPressHigh                  = 19,
   PreContr_erro_CuffPreSensRang                = 20,
   PreContr_erro_VolPreSensRang                 = 21,
   PreContr_erro_CuffPreExceed                  = 22,
   PreContr_erro_CuffPreExceLong                = 23,
   PreContr_erro_VolPreExceed                   = 24,
   PreContr_erro_CurrExceedLong                 = 25,
   SysIntgr_erro_VoltageSenseFailure            = 26,
   SysIntgr_erro_HcuRefSenseFailure             = 27,
   SysIntgr_erro_PletRefSenseFailure            = 28,
   SysIntgr_erro_HouseTempSenseFailure          = 29,
   SysIntgr_erro_cuffPressureSenseFailure       = 30,
   SysIntgr_erro_volumePressureSenseFailure     = 31,
   SysIntgr_erro_VoltageOutLimits               = 32,
   SysIntgr_erro_HcuRefOutLimits                = 33,
   SysIntgr_erro_PletRefOutLimits               = 34,
   SysIntgr_erro_cuffPressureSignalOffset       = 35,
   SysIntgr_erro_volumePressureSignalOffset     = 36,
   SysIntgr_erro_pressureSensorTimeout          = 37,
   missing_error_38                             = 38,
   AppContr_erro_PressureToHigh                 = 39,
   AppContr_erro_caseTemperatureOutLimits       = 40,
   AppContr_erro_pcbTemperatureOutLimits        = 41,
   AppContr_erro_MeasurementToLong              = 42,
   HcuContr_erro_hcuOffsetToBig                 = 43,
   HcuContr_erro_NotAllowed                     = 44,
   AppContr_erro_KeepAliveNotReceived           = 45,
   Driver_erro_SensorFailed                     = 46
}

export function getErrorCode(hwCode: number): NIBPErrorCodes {
   const enumValue: NIBPErrorCodes | undefined =
      NIBPErrorCodes[NIBPErrorCodes[hwCode] as keyof typeof NIBPErrorCodes];

   return enumValue ?? NIBPErrorCodes.GeneralError;
}

export const NIBPErrors: Record<NIBPErrorCodes, string> = {
   [NIBPErrorCodes.NoError]: '',
   [NIBPErrorCodes.GeneralError]: '',
   [NIBPErrorCodes.LedContr_erro_LowControlVolt]:
      'Please check the wrist unit and restart the device.',
   [NIBPErrorCodes.LedContr_erro_HighControlVolt]:
      'Unable to set correct LED current. Please inspect your hardware configuration.',
   [NIBPErrorCodes.LedContr_erro_HighLedCurrent]:
      'Unable to set correct LED current. Please inspect your hardware configuration.',
   [NIBPErrorCodes.LedContr_erro_TooManyIteratio]:
      'Unable to set correct LED current. Please inspect your hardware configuration.',
   [NIBPErrorCodes.LedContr_erro_CurrBelowDrift]:
      'Finger cuff (or cuff cable) loose or not connected.',
   [NIBPErrorCodes.LedContr_erro_CurrAboveDrift]:
      'Unable to set correct LED current. Please inspect your hardware configuration.',
   [NIBPErrorCodes.LedContr_erro_VoltBelowRange]:
      'Unable to set correct LED current. Please inspect your hardware configuration.',
   [NIBPErrorCodes.LedContr_erro_VoltAboveRange]:
      'Unable to set correct LED current. Please inspect your hardware configuration.',
   [NIBPErrorCodes.Plethysm_erro_TooMuchLight]:
      'The infrared level transmitted through the finger is too high. Try a smaller finger cuff.',
   [NIBPErrorCodes.PhysScan_erro_SyncBeatTimeOut]:
      'Odd plethysmogram detected, probably due to pressing the cuff or finger-tip.',
   [NIBPErrorCodes.PhysScan_erro_ScanFailed]:
      'No blood pressure signal. May be: finger too cold, incorrect cuff size or bad cuff position.',
   [NIBPErrorCodes.PhysScan_erro_BeatDownTimeOut]:
      'No plethysmogram detected. Check proper application of the finger cuff.',
   [NIBPErrorCodes.PresMoni_erro_IncorrectPress]:
      'Cuff pressure error. Please check the cuff air hose.',
   [NIBPErrorCodes.PresMoni_erro_UnstablePress]:
      'Cuff pressure unstable. Please check the cuff air hose.',
   [NIBPErrorCodes.ManoBeDe_erro_PressTooLow]:
      'Cuff pressure too low. Please check the cuff air hose.',
   [NIBPErrorCodes.SignInMo_erro_MeanPressLow]:
      'Mean pressure has been below 10mmHg for 2.5s. Please check the cuff air hose.',
   [NIBPErrorCodes.SignInMo_erro_UnacceptableP]:
      'The plethysmogram values moved out of range. This may be a movement artifact.',
   [NIBPErrorCodes.SignInMo_erro_MeanPressHigh]:
      'Mean pressure has been above 250 mmHg for 2.5s. Please check the cuff air hose.',
   [NIBPErrorCodes.PreContr_erro_CuffPreSensRang]:
      'Cuff pressure sensor out of range. Check if the finger cuff is wrapped tight enough around the finger.',
   [NIBPErrorCodes.PreContr_erro_VolPreSensRang]:
      'Volume pressure sensor out of range. Please check the cuff air hose.',
   [NIBPErrorCodes.PreContr_erro_CuffPreExceed]:
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.',
   [NIBPErrorCodes.PreContr_erro_CuffPreExceLong]:
      'Mean pressure has been above 250 mmHg for 2.5s. Please check the cuff air hose.',
   [NIBPErrorCodes.PreContr_erro_VolPreExceed]:
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.',
   [NIBPErrorCodes.PreContr_erro_CurrExceedLong]:
      'Current exceeded for too long. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_VoltageSenseFailure]:
      'One of the internal voltages being monitored has failed. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_HcuRefSenseFailure]:
      'Monitoring the reference voltage of the HCU has failed. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_PletRefSenseFailure]:
      'Plethysmograph reference monitor failed. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_HouseTempSenseFailure]:
      'Housing temperature sensor error. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_cuffPressureSenseFailure]:
      'Cuff pressure sensor failure. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_volumePressureSenseFailure]:
      'Cuff pressure sensor failure. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_VoltageOutLimits]:
      'Supply voltage error. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_HcuRefOutLimits]:
      'Plethysmograph ref out of limits. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_PletRefOutLimits]:
      'Plethysmograph ref out of limits. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_cuffPressureSignalOffset]:
      'Pressure signal offset too large. Please restart the wrist unit by reconnecting to HNIBP interface.',
   [NIBPErrorCodes.SysIntgr_erro_volumePressureSignalOffset]:
      'Pressure signal offset too large. Please keep the wrist unit stable during its start-up.',
   [NIBPErrorCodes.SysIntgr_erro_pressureSensorTimeout]:
      'Plethysmograph ref out of limits. Please keep the wrist unit stable during its start-up.',
   [NIBPErrorCodes.missing_error_38]: '',
   [NIBPErrorCodes.AppContr_erro_PressureToHigh]:
      'Pressure on the finger is too high, deflating for safety. May be because finger too cold, incorrect cuff size or bad cuff position.',
   [NIBPErrorCodes.AppContr_erro_caseTemperatureOutLimits]:
      'The housing of the wrist unit is too hot. Please check convection possibilities around the wrist unit.',
   [NIBPErrorCodes.AppContr_erro_pcbTemperatureOutLimits]:
      'The processor of the wrist unit is too hot. Please check convection possibilities around the wrist unit.',
   [NIBPErrorCodes.AppContr_erro_MeasurementToLong]:
      'The maximum time of 4 hours for measuring on a single cuff has exceeded. Please switch to another cuff.',
   [NIBPErrorCodes.HcuContr_erro_hcuOffsetToBig]:
      'HCU offset too large. Please retry zeroing.',
   [NIBPErrorCodes.HcuContr_erro_NotAllowed]:
      'HCU can not be zeroed during sampling. Please stop recording if HCU zeroing is needed.',
   [NIBPErrorCodes.AppContr_erro_KeepAliveNotReceived]:
      'The Keep Alive package has not been received in time from LabChart. Please check cables and restart the device and LabChart.',
   [NIBPErrorCodes.Driver_erro_SensorFailed]: 'Driver_erro_SensorFailed'
};

export const kHandleWarningFlag = 0x00800000;

// warnings that don't have the kHandleWarningFlag bit set will get ignored

// prettier-ignore
export enum WarningFlags {
   kNoWarning                         = 0x00 | 0,
   kGeneralWarning                    = 0x01 | kHandleWarningFlag,
   kPhysScan_warn_NewScanWithAHB      = (0x01 << 1) | 0,
   kPhysAdju_warn_BeatUpTimeOut       = (0x01 << 2) | kHandleWarningFlag,
   kPhysAdju_warn_BeatDownTimeOut     = (0x01 << 3) | kHandleWarningFlag,
   kManoBeDe_warn_PulseVeryLow        = (0x01 << 4) | 0,
   kManoBeDe_warn_NoPulse             = (0x01 << 5) | kHandleWarningFlag,
   kSignInMo_warn_DecreasePletSp      = (0x01 << 6) | 0,
   kOsciCont_warn_DecreasePletSp      = (0x01 << 7) | 0,
   kPreContr_warn_BadStart            = (0x01 << 8) | 0,
   kPreContr_warn_I2T_Protection      = (0x01 << 9) | 0,
   kPreContr_warn_HighCurrent         = (0x01 << 10) | 0,
   kPreContr_warn_PlungerPosEnd       = (0x01 << 11) | 0,
   kPreContr_warn_TrackingError       = (0x01 << 12) | 0,
   kPreContr_warn_PowerLimit          = (0x01 << 13) | 0,
   kSysIntgr_warn_PressureSensorTrend = (0x01 << 14) | 0,
   kAppContr_warn_MeasurementLong     = (0x01 << 15) | kHandleWarningFlag,
   kModFlow_warn_BraCalLong           = (0x01 << 16) | 0,
   kModFlow_warn_BraCalLongAborted    = (0x01 << 17) | 0 
}

// see Finapres Nano Core Error Codes v2.0.0.1678\

export const nanoWarningsArray = [
   {
      flag: WarningFlags.kNoWarning,
      message: 'No warning'
   },
   {
      flag: WarningFlags.kGeneralWarning,
      message: 'Unknown warning, please restart device if this keeps occurring.'
   },
   {
      flag: WarningFlags.kPhysScan_warn_NewScanWithAHB,
      message: 'PhysScan_warn_NewScanWithAHB'
   },
   {
      flag: WarningFlags.kPhysAdju_warn_BeatUpTimeOut,
      message: 'Physiocal error, please minimize finger movement.'
   },
   {
      flag: WarningFlags.kPhysAdju_warn_BeatDownTimeOut,
      message: 'Physiocal error, please minimize finger movement.'
   },
   {
      flag: WarningFlags.kManoBeDe_warn_PulseVeryLow,
      message: 'ManoBeDe_warn_PulseVeryLow'
   },
   {
      flag: WarningFlags.kManoBeDe_warn_NoPulse,
      message:
         'No pulse detected. Finger could be too cold, cuff size incorrect or in bad position.'
   },
   {
      flag: WarningFlags.kSignInMo_warn_DecreasePletSp,
      message: 'SignInMo_warn_DecreasePletSp'
   },
   {
      flag: WarningFlags.kOsciCont_warn_DecreasePletSp,
      message: 'OsciCont_warn_DecreasePletSp'
   },
   {
      flag: WarningFlags.kPreContr_warn_BadStart,
      message: 'PreContr_warn_BadStart'
   },
   {
      flag: WarningFlags.kPreContr_warn_I2T_Protection,
      message: 'PreContr_warn_I2T_Protection'
   },
   {
      flag: WarningFlags.kPreContr_warn_HighCurrent,
      message: 'PreContr_warn_HighCurrent'
   },
   {
      flag: WarningFlags.kPreContr_warn_PlungerPosEnd,
      message: 'PreContr_warn_PlungerPosEnd'
   },
   {
      flag: WarningFlags.kPreContr_warn_TrackingError,
      message: 'PreContr_warn_TrackingError'
   },
   {
      flag: WarningFlags.kPreContr_warn_PowerLimit,
      message: 'PreContr_warn_PowerLimit'
   },
   {
      flag: WarningFlags.kSysIntgr_warn_PressureSensorTrend,
      message: 'SysIntgr_warn_PressureSensorTrend'
   },
   {
      flag: WarningFlags.kAppContr_warn_MeasurementLong,
      message: 'Same cuff for 1.5 hours, please switch cuffs.'
   },
   {
      flag: WarningFlags.kModFlow_warn_BraCalLong,
      message: 'ModFlow_warn_BraCalLong'
   },
   {
      flag: WarningFlags.kModFlow_warn_BraCalLongAborted,
      message: 'ModFlow_warn_BraCalLongAborted'
   }
];
