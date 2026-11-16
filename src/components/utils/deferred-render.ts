/** Internal DOM handshake: holders stay in the block tree while their tools sleep. */
export const DEFERRED_RENDER_EVENT = 'blok:render-deferred';

/** Opening a row wakes its body, but each block still checks nested closed rows. */
export function renderDeferredDescendants(holder: HTMLElement): void {
  holder.querySelectorAll<HTMLElement>('[data-blok-deferred-render]').forEach((child) => {
    child.dispatchEvent(new Event(DEFERRED_RENDER_EVENT));
  });
}
