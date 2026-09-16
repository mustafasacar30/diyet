import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.diyetapp.mobile',
  appName: 'Diyet App',
  webDir: 'public',
  server: {
    url: 'https://diyet-five.vercel.app/',
    cleartext: true
  }
};

export default config;
