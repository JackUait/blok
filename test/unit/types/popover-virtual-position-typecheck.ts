/**
 * Compile-only assertions for the public virtual-position contract.
 * Run by the repository-wide `tsc --noEmit` gate.
 */
import type { PopoverParams } from '../../../types/utils/popover/popover';

const items: PopoverParams['items'] = [];
const position = new DOMRect(10, 20, 0, 16);
const positionContext = document.createElement('div');

const ordinaryTrigger: PopoverParams = {
  items,
  trigger: document.createElement('button'),
};

const trackedVirtualPosition: PopoverParams = {
  items,
  position,
  positionContext,
};

const dismissibleVirtualPosition: PopoverParams = {
  items,
  position,
  positionLifecycle: 'dismiss-on-nested-scroll',
};

// @ts-expect-error A virtual position must declare how it moves or dismisses.
const missingLifecycle: PopoverParams = {
  items,
  position,
};

// Legal without a virtual position: the context is the movement reference for
// the trigger-rect snapshot used once a hidden trigger stops being measurable.
const triggerSnapshotContext: PopoverParams = {
  items,
  trigger: document.createElement('button'),
  positionContext,
};

const conflictingLifecycle: PopoverParams = {
  items,
  position,
  positionContext,
  // @ts-expect-error A virtual position cannot both track and use dismissal policy.
  positionLifecycle: 'dismiss-on-nested-scroll',
};

void [
  ordinaryTrigger,
  trackedVirtualPosition,
  dismissibleVirtualPosition,
  missingLifecycle,
  triggerSnapshotContext,
  conflictingLifecycle,
];
