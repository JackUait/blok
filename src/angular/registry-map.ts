// src/angular/registry-map.ts
import type { BlockPortalRegistry } from './block-portal-registry';

/**
 * Associates each live Blok instance with its portal registry. `BlokContentDirective`
 * sets it at creation so consumers (and future composables) can reach an editor's
 * registry. WeakMap → no leak when the editor is destroyed.
 */
const registries = new WeakMap<WeakKey, BlockPortalRegistry>();

export function setRegistry(editor: WeakKey, registry: BlockPortalRegistry): void {
  registries.set(editor, registry);
}

export function getRegistry(editor: WeakKey): BlockPortalRegistry | undefined {
  return registries.get(editor);
}

export function removeRegistry(editor: WeakKey): void {
  registries.delete(editor);
}
