/// <reference types="vitest/config" />
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// mode=native builds for the Capacitor Android shell: the APK bundles all
// assets, so the service worker is skipped there (a SW inside the WebView
// would only add a stale-cache layer over app-bundled files).
export default defineConfig(({ mode }) => ({
  plugins: [
    preact(),
    ...(mode === 'native'
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['demo/demo.stj.json'],
            manifest: {
              name: '焊接助手',
              short_name: '焊接助手',
              description: '按取料顺序播报的焊接流水线助手',
              lang: 'zh-CN',
              theme_color: '#0f1216',
              background_color: '#0f1216',
              display: 'standalone',
              orientation: 'portrait',
              start_url: '/',
              icons: [
                { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
                {
                  src: '/icons/pwa-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              // the demo task must be available offline on first install
              globPatterns: ['**/*.{js,css,html,svg,png,json}'],
            },
          }),
        ]),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}));
