import type { BlockPortalRegistry } from './block-portal-registry';

/**
 * Associates each live Blok instance with its portal registry, keyed by the
 * editor (mirrors the holder WeakMap). `useBlok` sets it at creation;
 * `BlokContent` reads it to mount the shared `BlockPortalHost`. WeakMap → no
 * leak on destroy.
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
