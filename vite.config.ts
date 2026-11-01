import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  // Fixed port so the demo does not collide with other Vite apps on the default 5173; PORT overrides it.
  server: { port: Number(process.env.PORT) || 5180, strictPort: true },
  build: {
    lib: {
      entry: { 'cenitu-table': 'src/index.ts', react: 'src/react/index.tsx', formula: 'src/formula/index.ts', export: 'src/export/index.ts' },
      formats: ['es', 'cjs'],
    },
    rollupOptions: { external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'] },
  },
  test: { globals: true, environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
});
