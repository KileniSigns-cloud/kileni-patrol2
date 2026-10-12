import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Offline app shell. No update prompt on purpose: a new version installs in the
// background and takes over the next time Patrol is fully closed and reopened,
// so an update can never reload the page in the middle of a sign.
registerSW({
  immediate: true,
  onRegisterError: (err) => console.error('Service worker registration failed:', err),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
