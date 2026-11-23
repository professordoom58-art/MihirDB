import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import { ensureSeeded } from './lib/seed'
import './fonts.css'
import './styles.css'
import './ui.css'
import './stage.css'

// Load the bundled catalog on first launch before the first paint (no empty-shelf flash).
ensureSeeded().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)

// Service worker for the home-screen PWA (offline app shell + poster cache).
// Not used inside the native iOS app, where the assets are bundled already.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}
