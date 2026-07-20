// Patches Vitest's describe/it/beforeEach to run inside a Zone (zone.js target,
// per decision D7) and pulls in zone.js/testing — must come before TestBed use.
import '@analogjs/vite-plugin-angular/setup-vitest';

import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

// jest-dom matchers + jsdom polyfills (requestIdleCallback, adoptedStyleSheets,
// ResizeObserver) come from the shared core setup, listed alongside this file in
// the `unit-angular` project's setupFiles.

// Angular 21 removed TestBed's default zone-based change detection (TestBed is
// zoneless unless told otherwise), but this package is deliberately zone-based:
// BlokEditorComponent and BlokContentDirective inject NgZone and call
// runOutsideAngular. Restore zone CD so tests exercise production behaviour.
// It must live in the testing *module* (environment injector), not in the
// platform providers — the zone scheduler factory resolves against the
// environment injector and throws NG0402 from the platform level.
@NgModule({
  exports: [BrowserTestingModule],
  providers: [provideZoneChangeDetection()],
})
class ZoneTestingModule {}

getTestBed().initTestEnvironment(ZoneTestingModule, platformBrowserTesting());
