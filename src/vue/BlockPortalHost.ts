// src/vue/BlockPortalHost.ts
import { defineComponent, h, Teleport, Fragment, onErrorCaptured, type PropType } from 'vue';

import type { BlockPortalRegistry } from './block-portal-registry';

/**
 * Wraps a single block's render so a throw inside it can't tear down the whole
 * editor's render tree. `onErrorCaptured` returning false stops propagation.
 * Authored as a render function (no `.vue` SFC) per the adapter invariant.
 */
const BlockErrorBoundary = defineComponent({
  name: 'BlockErrorBoundary',
  setup(_props, { slots }) {
    onErrorCaptured(() => false);

    return () => slots.default?.();
  },
});

/**
 * The single shared render tree that teleports each registered Vue block into
 * its Blok-owned host element. Mounted once per editor (by `BlokContent`), it
 * iterates the reactive registry and emits one `<Teleport>` per entry — so all
 * blocks share one reconciler and the surrounding app's provide/inject context
 * (Teleport preserves the component render context, not the DOM target's).
 */
export const BlockPortalHost = defineComponent({
  name: 'BlockPortalHost',
  props: {
    registry: { type: Object as PropType<BlockPortalRegistry>, required: true },
  },
  setup(props) {
    return () =>
      h(
        Fragment,
        // Iterating the reactive Map tracks it, so register/unregister re-renders.
        Array.from(props.registry.entries.entries()).map(([id, entry]) =>
          h(Teleport, { key: id, to: entry.hostEl }, [
            h(BlockErrorBoundary, null, {
              default: () => h(entry.component, entry.props),
            }),
          ])
        )
      );
  },
});
