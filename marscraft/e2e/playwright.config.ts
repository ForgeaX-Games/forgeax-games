// Playwright e2e config for the MarsCraft port (M17).
//
// These specs drive the game deterministically through the `window.__marscraft`
// debug hooks against the running preview-runtime dev server on :15173
// (`/preview/?game=marscraft`). They codify the manual verification done across
// M0–M16 into a repeatable suite.
//
// PREREQ: the dev stack must be up (`bun fx start` from the repo root) so
// :15173 serves the preview. There is no webServer entry here — starting the
// full studio stack from a test config is too heavy and the port is shared; run
// the stack once, then `npx playwright test` from this dir (or point --config
// here). `reuseExistingServer` is moot without a webServer.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false, // shared :15173 preview + stateful hooks → sequential
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:15173',
    headless: true,
    // WebGPU needs the unsafe flag + no GPU blocklist in headless Chromium
    // (mirrors how `bun fx start` launches Chrome for the web stack).
    launchOptions: {
      args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-gl=angle'],
    },
  },
  projects: [{ name: 'chromium', use: { channel: 'chrome' } }],
});
