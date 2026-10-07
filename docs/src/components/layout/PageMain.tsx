import type { ComponentPropsWithoutRef } from 'react';

/** The id Nav's skip link points at. Only PageMain may render it. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * The page's <main>. It owns the skip link's target so no page can ship the
 * link without one. tabIndex -1 lets the skip link move focus here.
 */
export const PageMain = (props: Omit<ComponentPropsWithoutRef<'main'>, 'id' | 'tabIndex'>) => (
  <main {...props} id={MAIN_CONTENT_ID} tabIndex={-1} />
);
