import { defineConfig, devices } from '@playwright/test';

const baseURL = `http://localhost:${process.env.PORT || 5180}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, viewport: { width: 1000, height: 700 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1000, height: 700 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1000, height: 700 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1000, height: 700 } } },
  ],
  webServer: { command: 'npm run dev', url: `${baseURL}/e2e/index.html`, reuseExistingServer: true },
});
