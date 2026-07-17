import { Component, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BlockPortalRegistry } from './block-portal-registry';

interface BoundaryState {
  failed: boolean;
}

/**
 * Wraps a single block's render so a throw inside it can't tear down the whole
 * editor's render tree (only the broken block goes blank).
 */
class BlockErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  public state: BoundaryState = { failed: false };

  public static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  public componentDidCatch(): void {
    // Swallowed: one broken block must not unmount its siblings.
  }

  public render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface BlockPortalHostProps {
  registry: BlockPortalRegistry;
}

/**
 * The single shared render tree that portals each registered React block into
 * its Blok-owned host element. Mounted once per editor (by `BlokContent`), it
 * subscribes to the registry and emits one `createPortal` per entry — so all
 * blocks share one reconciler and the surrounding app's React context
 * (`createPortal` preserves the component tree's context, not the DOM target's).
 */
export function BlockPortalHost({ registry }: BlockPortalHostProps): ReactElement {
  const entries = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);

  return (
    <>
      {Array.from(entries.entries()).map(([id, entry]) => {
        const BlockComponent = entry.component;

        return createPortal(
          <BlockErrorBoundary>
            <BlockComponent {...entry.props} />
          </BlockErrorBoundary>,
          entry.hostEl,
          id
        );
      })}
    </>
  );
}
