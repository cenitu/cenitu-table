import { defineConfig } from 'vite';

/** Builds the demo page as a static site (GitHub Pages serves it under /cenitu-table/). */
export default defineConfig({
  base: process.env.DEMO_BASE ?? '/cenitu-table/',
  build: { outDir: 'demo-dist', emptyOutDir: true },
});
