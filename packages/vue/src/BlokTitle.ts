import { defineComponent, h, onBeforeUnmount, onMounted, ref, toRaw, watch, type PropType } from 'vue';
import { getHolder } from './holder-map';
import type { Blok } from '@/types';

/**
 * Places the editor's page title in a `<div>` of your own, through `editor.title.mount`.
 * The editor needs `pageTitle` set; this only moves the title.
 * On unmount the title goes back above the first block. Slot content is not rendered.
 */
export const BlokTitle = defineComponent({
  name: 'BlokTitle',
  props: {
    editor: {
      type: Object as PropType<Blok | null>,
      default: null,
    },
  },
  setup(props) {
    const container = ref<HTMLDivElement | null>(null);

    const place = (editor: Blok | null): void => {
      if (editor !== null && container.value !== null) {
        toRaw(editor).title.mount(container.value);
      }
    };

    const release = (editor: Blok | null): void => {
      // A destroyed editor has no title; useBlok drops the holder before every destroy.
      if (editor !== null && getHolder(toRaw(editor)) !== undefined) {
        toRaw(editor).title.mount(null);
      }
    };

    onMounted(() => {
      place(props.editor);
    });

    watch(
      () => props.editor,
      (next, previous) => {
        release(previous ?? null);
        place(next);
      }
    );

    onBeforeUnmount(() => {
      release(props.editor);
    });

    return () => h('div', { ref: container });
  },
});
