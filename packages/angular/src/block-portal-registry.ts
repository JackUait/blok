// packages/angular/src/block-portal-registry.ts
import {
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
  ErrorHandler,
  Injector,
  type ComponentRef,
  type Signal,
  type Type,
} from '@angular/core';

import type { Blok } from '@/types';

import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from './block-context';
import { BLOK_EDITOR_INSTANCE } from './blok-instance';

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
  /**
   * Detach + destroy the component for `id`. Safe (no-op) when absent.
   *
   * Pass the caller's own `hostEl` to make the teardown OWNERSHIP-CHECKED: the
   * mount is destroyed only when it is still the one that host registered. Core
   * composes a replacement block (which registers under the SAME id) BEFORE it
   * destroys the block it replaces, so a superseded tool's `removed()`/
   * `destroy()` teardown arrives after the live mount already exists — without
   * the check it destroys that live componentRef and clears its host.
   */
  unregister(id: string, hostEl?: HTMLElement): void;
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
 *
 * `editor` is the directive's own instance signal. It is passed at CREATION
 * (before the editor exists) rather than set later precisely because it is a
 * signal: blocks mounted during boot read null and re-read the real instance
 * once it resolves.
 * @param envInjector - the app environment injector (parent of each block's)
 * @param appRef - the ApplicationRef each mounted block view is attached to
 * @param errorHandler - where a throwing author component is reported
 * @param editor - signal of the live Blok instance, published to blocks via
 *   {@link BLOK_EDITOR_INSTANCE}; omit for registries with no editor to publish
 */
export const createBlockPortalRegistry = (
  envInjector: EnvironmentInjector,
  appRef: ApplicationRef,
  errorHandler: ErrorHandler,
  editor?: Signal<Blok | null>
): BlockPortalRegistry => {
  const mounted = new Map<string, { ref: ComponentRef<unknown>; injector: Injector }>();

  // Change detection runs outside NgZone here; a throwing author component must
  // degrade to a blank holder, not break core's block insertion.
  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      errorHandler.handleError(error);
    }
  };

  const teardown = (id: string, ownerHostEl?: HTMLElement): void => {
    const entry = mounted.get(id);

    if (entry === undefined) {
      return;
    }

    const { ref, injector } = entry;
    // Capture host before deletion so we can clear it below.
    const hostEl = ref.location.nativeElement as HTMLElement;

    // A superseded owner may not destroy the mount that replaced it.
    if (ownerHostEl !== undefined && hostEl !== ownerHostEl) {
      return;
    }

    mounted.delete(id);
    appRef.detachView(ref.hostView);
    ref.destroy();
    // `Injector.create({ parent })` returns an injector that is NOT torn down by
    // `ref.destroy()`. We must destroy it explicitly to prevent one small injector
    // accumulating per block over a long editor session.
    const destroyable = injector as Injector & { destroy?: () => void };
    destroyable.destroy?.();
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
        providers: [
          { provide: BLOK_BLOCK_CONTEXT, useValue: entry.context },
          // Per-EDITOR, so two editors on one page each publish their own
          // instance to their own blocks.
          ...(editor === undefined
            ? []
            : [{ provide: BLOK_EDITOR_INSTANCE, useValue: editor }]),
        ],
        parent: envInjector,
      });

      safe(() => {
        const ref = createComponent(entry.component, {
          environmentInjector: envInjector,
          elementInjector,
          hostElement: entry.hostEl,
        });

        appRef.attachView(ref.hostView);
        mounted.set(id, { ref, injector: elementInjector });
        // createComponent does not auto-run CD; render synchronously into the
        // (still-detached) host before core inserts it into the document.
        ref.changeDetectorRef.detectChanges();
      });
    },
    unregister(id: string, hostEl?: HTMLElement): void {
      teardown(id, hostEl);
    },
    flush(id: string): void {
      const entry = mounted.get(id);

      if (entry === undefined) {
        return;
      }

      safe(() => entry.ref.changeDetectorRef.detectChanges());
    },
    destroyAll(): void {
      for (const id of Array.from(mounted.keys())) {
        teardown(id);
      }
    },
  };
};
