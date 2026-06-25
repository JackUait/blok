// Patches Vitest's describe/it/beforeEach to run inside a Zone (zone.js target,
// per decision D7) and pulls in zone.js/testing — must come before TestBed use.
import '@analogjs/vite-plugin-angular/setup-vitest';

import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// jest-dom matchers + jsdom polyfills (requestIdleCallback, adoptedStyleSheets,
// ResizeObserver) come from the shared core setup, listed alongside this file in
// the `unit-angular` project's setupFiles.

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
