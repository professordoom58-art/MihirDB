import os from 'node:os'
import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Two kinds of iOS build:
 *
 *  - release (default): the web app is bundled into the IPA and works offline.
 *  - live (CAP_LIVE=1): the app loads your laptop's dev server, so code changes show
 *    up instantly without reinstalling. Set CAP_LIVE_URL to the laptop address
 *    (e.g. http://192.168.1.23:5173). Locally it's auto-detected; in GitHub Actions
 *    it comes from the workflow's `live_url` input.
 */
const live = process.env.CAP_LIVE === '1'

function lanUrl(): string {
  if (process.env.CAP_LIVE_URL) return process.env.CAP_LIVE_URL
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) {
        return `http://${a.address}:5173`
      }
    }
  }
  throw new Error('CAP_LIVE=1 but no LAN address found. Set CAP_LIVE_URL=http://<laptop-ip>:5173')
}

const config: CapacitorConfig = {
  appId: 'com.mihir.shelf',
  appName: 'Shelf',
  webDir: 'dist',
  backgroundColor: '#050506',
  ios: {
    contentInset: 'never',
    backgroundColor: '#050506',
    scrollEnabled: false, // no rubber-band on the whole WebView; inner scrollers still scroll
  },
  ...(live
    ? {
        server: {
          url: lanUrl(),
          cleartext: true, // dev only: plain http to the laptop
        },
      }
    : {}),
}

export default config
