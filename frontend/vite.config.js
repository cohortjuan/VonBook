import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// installable PWA: manifest + service worker so "add to home screen" on a
// phone actually works and gives VonBook its own icon/splash instead of
// just being a bookmark. autoUpdate means a new deploy replaces the cached
// version on the next visit without the user having to do anything.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'VonBook',
        short_name: 'VonBook',
        description: 'Friends, feed, chat, and calls -- all in one place.',
        theme_color: '#7c3aed',
        background_color: '#0f0b1e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
