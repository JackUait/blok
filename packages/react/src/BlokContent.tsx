import { useEffect, useRef, forwardRef } from 'react';
import { getHolder } from './holder-map';
import { getRegistry } from './registry-map';
import { BlockPortalHost } from './BlockPortalHost';
import type { Blok } from '@/types';
import type { BlokContentProps } from './types';

/**
 * Re-drive the boot-time URL-hash scroll now that the editor's holder is in the
 * document. Reads the current hash, decodes it (falling back to the raw value on
 * a malformed percent-sequence, which simply matches no block), and asks the
 * editor to scroll — a one-shot drain of the navigation the constructor deferred
 * because the holder was detached. No-op when the URL carries no hash.
 * @param editor - the ready Blok instance whose holder just connected
 */
function drainDeferredHashScroll(editor: Blok): void {
  if (typeof window === 'undefined') {
    return;
  }

  const raw = window.location.hash.slice(1);

  if (raw === '') {
    return;
  }

  editor.blocks.scrollToBlock?.(safeDecodeHashFragment(raw));
}

/**
 * Decodes a URL hash fragment, falling back to the raw value on a malformed
 * percent-sequence (e.g. `%ZZ`) — which simply matches no block downstream.
 * @param raw - hash fragment without the leading `#`
 */
function safeDecodeHashFragment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

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

      // The editor rendered its seeded content into this holder while it was
      // still detached from the document, so the boot-time URL-hash scroll —
      // which queries the LIVE document — found nothing and deferred. Now that
      // the holder is connected, drain that deferred navigation once via the
      // public scroll API (a no-op when there's no matching hash/block), so
      // consumers don't have to hand-roll a DOM-polling hook.
      drainDeferredHashScroll(editor);

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
