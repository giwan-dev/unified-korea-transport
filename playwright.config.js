import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', timeout: 180000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'chrome', headless: true,
    locale: 'ko-KR', viewport: {width: 1440, height: 960},
    launchOptions: {args: ['--enable-unsafe-swiftshader']}, screenshot: 'only-on-failure' },
  webServer: {command: 'python3 tools/serve.py 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true},
});
