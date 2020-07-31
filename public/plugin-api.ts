export type PluginFeatureTypes =
   | 'Channel Calculation Function'
   | 'Device Class'
   | 'Device UI';

/**
 * Base class for any objects in Lightning that have resources that need to be disposed.
 */
export interface ILcModel {
   create?(): void;
   dispose?(): void;
   disposeAsync?(): Promise<void>;
}

/**
 * This is the contract that plugin feature writers adhere to.
 */
export interface IPluginModuleFeature extends ILcModel {
   name: string;
   type: PluginFeatureTypes;
}

export function isPluginModuleFeature(
   obj: unknown
): obj is IPluginModuleFeature {
   const objAsOut = obj as IPluginModuleFeature;

   return (
      objAsOut.name !== undefined &&
      typeof objAsOut.name === 'string' &&
      objAsOut.type !== undefined
   );
}
