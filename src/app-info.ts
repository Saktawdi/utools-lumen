// Vite reads these values from the plugin manifest and package metadata.
declare const __LUMEN_APP_INFO__: Readonly<{
  name: string;
  version: string;
  repositoryUrl: string;
}>;

export const appInfo = __LUMEN_APP_INFO__;
