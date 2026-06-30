// src/angular/block-portal-registry.ts
import {
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
  ErrorHandler,
  Injector,
  type ComponentRef,
  type Type,
} from '@angular/core';

import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from './block-context';

/**
 * Tool-config key carrying the editor's portal registry into a
 * `createAngularBlock` tool. The tool is constructed by CORE (outside any Angular
 * injection context), so it cannot `inject()` — the directive injects the
 * editor-scoped registry through each Angular-block tool's `config`, and the tool
 * reads it back from there.
 */
export const BLOK_PORTAL_REGISTRY_CONFIG_KEY = '__blokAngularPortalRegistry';

/** One mounted Angular block: the Blok-owned host the component renders into. */
export interface BlockPortalEntry {
  hostEl: HTMLElement;
  component: Type<unknown>;
  context: AngularBlockRenderContext<unknown>;
}

/**
 * Per-editor registry of Angular blocks. Mounts each authored component directly
 * into its core-owned host via `createComponent({ hostElement })` (the Teleport
 * analog) and enrolls it in `ApplicationRef` for change detection. A plain Map —
 * Angular has no reactive-proxy hazard, so no `markRaw` equivalent is needed.
 */
export interface BlockPortalRegistry {
  /** Mount (or replace) the component for `id` into `entry.hostEl`. */
  register(id: string, entry: BlockPortalEntry): void;
  /** Detach + destroy the component for `id`. Safe (no-op) when absent. */
  unregister(id: string): void;
  /** Re-run change detection on the block's component (in-place update). */
  flush(id: string): void;
  /** Detach + destroy every mounted block (editor teardown / recreate). */
  destroyAll(): void;
}

/**
 * Create a fresh portal registry bound to a live Angular environment. One per
 * editor instance (associated via the registry map). The injectors/appRef are
 * passed in (captured by the directive in an injection context) because the
 * registry itself is built outside one.
 */
export const createBlockPortalRegistry = (
  envInjector: EnvironmentInjector,
  appRef: ApplicationRef,
  errorHandler: ErrorHandler
): BlockPortalRegistry => {
  const mounted = new Map<string, ComponentRef<unknown>>();

  // Change detection runs outside NgZone here; a throwing author component must
  // degrade to a blank holder, not break core's block insertion.
  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      errorHandler.handleError(error);
    }
  };

  const teardown = (id: string): void => {
    const ref = mounted.get(id);

    if (ref === undefined) {
      return;
    }

    // Capture host before deletion so we can clear it below.
    const hostEl = ref.location.nativeElement as HTMLElement;
    mounted.delete(id);
    appRef.detachView(ref.hostView);
    ref.destroy();
    // createComponent({ hostElement }) renders INTO an external div. Angular's
    // destroy() tears down the component instance and CD but does NOT clear the
    // host's DOM children — we must do it explicitly.
    hostEl.replaceChildren();
  };

  return {
    register(id: string, entry: BlockPortalEntry): void {
      // Idempotent: replace any prior mount for this id.
      teardown(id);

      // The context is provided through an ELEMENT injector (a node injector),
      // so it is destroyed automatically with the component view — no leaked
      // EnvironmentInjector. The shared app envInjector is the parent, so author
      // blocks still see app-level providers (HttpClient, etc.).
      const elementInjector = Injector.create({
        providers: [{ provide: BLOK_BLOCK_CONTEXT, useValue: entry.context }],
        parent: envInjector,
      });

      safe(() => {
        const ref = createComponent(entry.component, {
          environmentInjector: envInjector,
          elementInjector,
          hostElement: entry.hostEl,
        });

        appRef.attachView(ref.hostView);
        mounted.set(id, ref);
        // createComponent does not auto-run CD; render synchronously into the
        // (still-detached) host before core inserts it into the document.
        ref.changeDetectorRef.detectChanges();
      });
    },
    unregister(id: string): void {
      teardown(id);
    },
    flush(id: string): void {
      const ref = mounted.get(id);

      if (ref === undefined) {
        return;
      }

      safe(() => ref.changeDetectorRef.detectChanges());
    },
    destroyAll(): void {
      for (const id of Array.from(mounted.keys())) {
        teardown(id);
      }
    },
  };
};
