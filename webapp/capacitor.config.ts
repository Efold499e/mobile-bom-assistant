import type { CapacitorConfig } from '@capacitor/cli';

// Native shell for the weld assistant: the PWA bundle ships inside the APK
// (webDir=dist), fully offline. Build the web assets with the `native` vite
// mode first (skips the service worker) so `npx cap sync` copies a clean tree:
//   tsc -b && vite build --mode native && npx cap sync
const config: CapacitorConfig = {
  appId: 'com.weldassist.app',
  appName: '焊接助手',
  webDir: 'dist',
};

export default config;
