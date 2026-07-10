import { defineComponent, h, onMounted, onBeforeUnmount, ref, toRaw, watch, type PropType } from 'vue';
import { getHolder } from './holder-map';
import { getRegistry } from './registry-map';
import { BlockPortalHost } from './BlockPortalHost';
import type { Blok } from '@/types';

/**
 * Provides the DOM mount point for a Blok editor. Renders a `<div>` and adopts
 * the editor's detached holder element into it (the Vue analog of React's
 * `BlokContent`). When `editor` is null it renders an empty div for layout
 * stability. The holder subtree is owned entirely by core — Vue's renderer never
 * manages its children, so the container is always rendered with no vnode
 * children and the holder is appended/removed imperatively.
 *
 * `toRaw` unwraps the editor before the holder-map lookup: Vue stores the object
 * prop behind a reactive proxy, and the holder WeakMap is keyed by the raw Blok
 * instance (Risk R0 — Vue proxies must never be used as identity keys).
 */
export const BlokContent = defineComponent({
  name: 'BlokContent',
  props: {
    editor: {
      type: Object as PropType<Blok | null>,
      default: null,
    },
  },
  setup(props) {
    const container = ref<HTMLDivElement | null>(null);

    const adopt = (editor: Blok | null): void => {
      if (container.value === null || editor === null) {
        return;
      }

      const holder = getHolder(toRaw(editor));

      if (holder === undefined) {
        return;
      }

      container.value.appendChild(holder);
    };

    const detach = (editor: Blok | null): void => {
      if (editor === null) {
        return;
      }

      getHolder(toRaw(editor))?.remove();
    };

    onMounted(() => {
      adopt(props.editor);
    });

    watch(
      () => props.editor,
      (next, previous) => {
        detach(previous ?? null);
        adopt(next);
      }
    );

    onBeforeUnmount(() => {
      detach(props.editor);
    });

    return () => {
      const editorVal = props.editor;
      // The shared portal host for `createVueBlock` tools (when this editor has
      // one). It emits ONLY <Teleport> anchors — no real DOM in the container —
      // so the imperatively-appended holder is undisturbed and the container
      // stays a single root for attribute fallthrough. Registry-less editors
      // (vanilla-only) render the bare div exactly as before.
      const registry = editorVal === null ? undefined : getRegistry(toRaw(editorVal));

      return h('div', { ref: container }, registry === undefined ? [] : [h(BlockPortalHost, { registry })]);
    };
  },
});
