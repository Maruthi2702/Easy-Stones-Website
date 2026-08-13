import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Disable service worker in dev mode — only active in production builds
      devOptions: {
        enabled: false
      },
      includeAssets: ['favicon.png', 'logo.png'],
      workbox: {
        // registerType: 'autoUpdate' only controls how the client *asks* for an
        // update — without these, a new worker still waits for every tab on the
        // old one to close before it activates, which is what actually made a
        // fresh deploy take two or three refreshes to show up. skipWaiting +
        // clientsClaim let it take over as soon as it installs, so the
        // controllerchange handler in src/main.jsx fires (and reloads) on its own.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api/, /\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api'),
            handler: 'NetworkOnly'
          }
        ]
      },
      manifest: {
        name: 'Easy Stones',
        short_name: 'Easy Stones',
        description: 'Premium Stone Inventory & Sales',
        theme_color: '#000000',
        background_color: '#000000',
        icons: [
          {
            src: 'logo.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'logo.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    },
  },
})
