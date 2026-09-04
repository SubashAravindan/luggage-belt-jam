import type { CapacitorConfig } from '@capacitor/cli';

// NOTE: `npx cap add android` intentionally NOT run — config only (CI has no
// Android SDK). To sync locally: npm run build, then `npm run cap:sync`.
// Requires: npm i -D @capacitor/android (then npx cap add android once).
const config: CapacitorConfig = {
  appId: 'com.studio.luggagebeltjam',
  appName: 'Luggage Belt Jam',
  webDir: 'dist',
  androidScheme: 'https',
};

export default config;
