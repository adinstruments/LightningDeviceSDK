const kEnableLogging = true;
export const kLogAllWarnings = kEnableLogging && true;

/**
 * Use this to write out to the console but only if debugging enabled
 */
export function debugLog(message?: any, ...optionalParams: any[]) {
   if (kEnableLogging) {
      if (optionalParams?.length) {
         console.log(message, optionalParams);
      } else {
         console.log(message);
      }
   }
}
