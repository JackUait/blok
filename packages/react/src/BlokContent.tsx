import { useEffect, useRef, forwardRef } from 'react';
import { getHolder } from './holder-map';
import { getRegistry } from './registry-map';
import { BlockPortalHost } from './BlockPortalHost';
import type { BlokContentProps } from './types';

/**
 * Component that provides the DOM mount point for a Blok editor.
 * Renders a <div> and adopts the editor's detached holder DOM into it.
 * When editor is null, renders an empty div (for layout stability).
 * Passes through all standard HTML div attributes (className, style, etc.).
 */
export const BlokContent = forwardRef<HTMLDivElement, BlokContentProps>(
  function BlokContent({ editor, ...divProps }, ref) {
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

    useEffect(() => {
      if (editor === null || containerRef.current === null) {
        return;
      }

      const holder = getHolder(editor);

      if (holder === undefined) {
        return;
      }

      containerRef.current.appendChild(holder);

      return (): void => {
        holder.remove();
      };
    }, [editor]);

    // The portal host renders the editor's `createReactBlock` tools INSIDE this
    // component tree (via createPortal into each Blok-owned host element), so
    // app-level React context flows into block tools with no bridge. It emits
    // no DOM at this position, leaving the imperatively-adopted holder alone.
    const registry = editor === null ? undefined : getRegistry(editor);

    return (
      <div ref={setRefs} {...divProps}>
        {registry === undefined ? null : <BlockPortalHost registry={registry} />}
      </div>
    );
  }
);
