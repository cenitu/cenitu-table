import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  // Fixed port so the demo does not collide with other Vite apps on the default 5173.
  server: { port: 5180, strictPort: true },
  build: {
    lib: {
      entry: { 'cenitu-table': 'src/index.ts', react: 'src/react/index.tsx' },
      formats: ['es', 'cjs'],
    },
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  },
  test: { globals: true, environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
});
