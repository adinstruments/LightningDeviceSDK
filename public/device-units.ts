import { UnitsInfo, UnitPrefix } from './device-api';

export function prefixedUnitChar(prefix: UnitPrefix) {
   const result = 'afpn\u00B5mkMGTPE'.charAt(prefix - UnitPrefix.kAtto);
   return result;
}

export class UnitsInfoImpl implements UnitsInfo {
   constructor(
      public unitName: string,
      public prefix: UnitPrefix,
      public defaultDecPlaces: number,
      public maxInPrefixedUnits: number,
      public maxInADCValues: number,
      public minInPrefixedUnits: number,
      public minInADCValues: number,
      public maxValidADCValue: number, //gray limit lines and "out of range" displayed above this value
      public minValidADCValue: number //gray limit lines and "out of range" displayed below this value
   ) {}

   get prefixedUnitName() {
      const prefixStr =
         this.prefix > UnitPrefix.kNoPrefix
            ? ' ' + prefixedUnitChar(this.prefix)
            : '';
      return prefixStr + this.unitName;
   }

   get rangeDisplayString() {
      return this.maxInPrefixedUnits + this.prefixedUnitName;
   }
}

export class UnitsInfo16Bit extends UnitsInfoImpl {
   constructor(
      unitName: string,
      prefix: UnitPrefix,
      defaultDecPlaces: number,
      maxInPrefixedUnits: number,
      minInPrefixedUnits: number
   ) {
      super(
         unitName,
         prefix,
         defaultDecPlaces,
         maxInPrefixedUnits,
         0x7fff, // maxInADCValues
         minInPrefixedUnits,
         -0x7fff, //minInADCValues
         0x7fff, //maxValidADCValue
         -0x7fff //minValidADCValue
      );
   }
}
