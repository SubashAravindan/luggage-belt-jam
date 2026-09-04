import { defineConfig } from 'vite';

// Capacitor + GitHub Pages friendly: relative asset paths.
// NOTE: vite-plugin-pwa intentionally NOT added (zero-new-deps policy);
// PWA installability is covered by manifest.webmanifest + SVG icons in public/.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
  },
});
