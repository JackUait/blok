import { useLayoutEffect, useRef, forwardRef } from 'react';
import type { Blok } from '@/types';
import type { BlokTitleProps } from './types';

/**
 * Places the editor's page title in a div of your own.
 * The editor needs `pageTitle` set; this only moves the title.
 * On unmount the title goes back above the first block.
 */
export const BlokTitle = forwardRef<HTMLDivElement, BlokTitleProps>(
  function BlokTitle({ editor, ...divProps }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const setRefs = (node: HTMLDivElement | null): void => {
      containerRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref !== null && ref !== undefined) {
        const mutableRef = ref;

        mutableRef.current = node;
      }
    };

    // Layout, not passive: its cleanup runs before React removes the div, so the header is never detached.
    useLayoutEffect(() => {
      const host = containerRef.current;

      if (editor === null || host === null) {
        return;
      }
      editor.title.mount(host);

      return (): void => {
        // A destroyed editor has no title: destroy deletes its fields.
        const title = (editor as { title?: Partial<Blok['title']> }).title;

        if (typeof title?.mount === 'function') {
          title.mount(null);
        }
      };
    }, [editor]);

    // Children are dropped: the div belongs to Blok.
    const { children: _children, ...rest } = divProps as typeof divProps & { children?: unknown };

    return <div ref={setRefs} {...rest} />;
  }
);
