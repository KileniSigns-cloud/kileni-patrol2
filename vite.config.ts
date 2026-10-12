import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' = a new version waits until every Patrol window is closed.
      // 'autoUpdate' would reload the page mid-patrol and lose the sign being logged.
      registerType: 'prompt',
      injectRegister: false, // registered in src/main.tsx
      manifest: false, // the manifest stays in public/manifest.webmanifest
      workbox: {
        // App shell only: JS, CSS, HTML, icons, manifest. Supabase calls are never cached here.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Manrope font stylesheet + files, so the offline app keeps its look.
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'patrol-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
})
