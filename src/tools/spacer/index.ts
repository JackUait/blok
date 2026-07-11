import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  SanitizerConfig,
  ToolboxConfig,
} from '../../../types';
import type { SpacerData } from './types';
import { IconSpacer } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import { AlignmentGuide, collectSiblingBlockBottoms, findSnapTarget } from './alignment-guide';
import { COLUMNS_ATTR } from '../columns-shared';

/**
 * Height bounds and default (px). The minimum matches the default Text block
 * height (16px base font × 1.5 line-height + the blok-block 7px vertical
 * paddings) so a spacer never gets thinner than one line of text; the maximum
 * stops a stray drag from swallowing the page.
 */
const MIN_HEIGHT = 38;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 38;

/**
 * Keyboard resize step for ArrowUp/ArrowDown on a grip (px).
 */
const KEYBOARD_STEP = 8;

type GripEdge = 'top' | 'bottom';

/**
 * Hover discoverability outline; present only while editable
 */
const HOVER_OUTLINE_CLASSES = ['hover:outline-dashed', 'hover:outline-1', 'hover:outline-(--blok-color-accent)'];

/**
 * Non-hover-gated outline used while the chrome is force-shown
 * (fresh insert, active drag)
 */
const PINNED_OUTLINE_CLASSES = ['outline-dashed', 'outline-1', 'outline-(--blok-color-accent)'];

const clampHeight = (value: number): number => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value));

/**
 * Spacer block tool — an adjustable vertical gap.
 *
 * Stores a single `height` in px. Drag either edge grip (or focus one and
 * press ArrowUp/ArrowDown) to resize. Its main job is lining up content across
 * sibling columns of unequal length, replacing piles of empty paragraphs.
 */
export class SpacerTool implements BlockTool {
  /**
   * Rendered wrapper element
   */
  private element: HTMLElement | null = null;

  /**
   * Resize grips on the top and bottom edges; absent in read-only mode
   */
  private grips: HTMLElement[] = [];

  /**
   * Decorative px readout shown on hover; absent in read-only mode
   */
  private readout: HTMLElement | null = null;

  /**
   * Current gap height in px
   */
  private height: number;

  /**
   * Whether the tool is currently read-only
   */
  private readOnly: boolean;

  /**
   * Whether this spacer was just created (no stored height yet). A fresh
   * spacer is visually identical to the empty paragraph it replaced, so it
   * reveals its resize chrome until the user interacts elsewhere — otherwise
   * inserting one from the toolbox looks like nothing happened.
   */
  private isFresh: boolean;

  /**
   * Removes the fresh-reveal document listeners; null when no reveal is active
   */
  private dismissFreshReveal: (() => void) | null = null;

  /**
   * Guideline drawn when a dragged edge lines up with a sibling column's block
   */
  private guide = new AlignmentGuide();

  /**
   * Blok API for i18n
   */
  private api: API;

  /**
   * @param options - block tool constructor options
   */
  constructor(options: BlockToolConstructorOptions<SpacerData>) {
    this.api = options.api;
    this.readOnly = options.readOnly;
    this.isFresh = typeof options.data.height !== 'number';
    this.height = clampHeight(typeof options.data.height === 'number' ? options.data.height : DEFAULT_HEIGHT);
  }

  /**
   * Render the gap: an empty wrapper whose inline height IS the content,
   * plus resize grips on both edges when editable.
   */
  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-spacer', '');
    wrapper.className = twMerge('relative', 'group/spacer', 'rounded-md');
    wrapper.style.height = `${this.height}px`;
    this.element = wrapper;

    if (!this.readOnly) {
      // The gap is invisible content — the hover outline + px readout are what
      // make it discoverable as a real, resizable block instead of plain
      // margin. In read-only mode the spacer stays fully invisible.
      this.addHoverOutline();
      this.attachGrips();

      if (this.isFresh) {
        this.revealFreshChrome();
      }
    }

    return wrapper;
  }

  /**
   * Clean up the fresh-reveal document listeners when the block is removed
   */
  public removed(): void {
    this.dismissFreshReveal?.();
    this.guide.hide();
  }

  /**
   * Persist the current height
   */
  public save(): SpacerData {
    return { height: this.height };
  }

  /**
   * Always valid — height is clamped on construction
   */
  public validate(_data: SpacerData): boolean {
    return true;
  }

  /**
   * Toggle read-only in place by adding/removing the resize grips
   */
  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    if (state) {
      this.dismissFreshReveal?.();
      this.element?.classList.remove(...HOVER_OUTLINE_CLASSES);
      this.grips.forEach((grip) => grip.remove());
      this.grips = [];
      this.readout?.remove();
      this.readout = null;
    } else if (this.element !== null && this.grips.length === 0) {
      this.addHoverOutline();
      this.attachGrips();
    }
  }

  /**
   * Toolbox appearance
   */
  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconSpacer,
      titleKey: 'spacer',
      searchTerms: ['spacer', 'space', 'gap', 'blank', 'whitespace', 'margin', 'padding'],
      searchTermKeys: ['spacer', 'space', 'gap'],
    };
  }

  /**
   * Spacer works in read-only mode (renders the gap, hides the grips)
   */
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Nothing to sanitize — no HTML content
   */
  public static get sanitize(): SanitizerConfig {
    return {};
  }

  /**
   * Apply a new height to the element and keep the grips' aria values in sync.
   * The inline style mutation is inside the observed block subtree, so the
   * change reaches the Saver/undo pipeline via the regular MutationObserver.
   */
  private setHeight(value: number): void {
    this.height = clampHeight(Math.round(value));

    if (this.element !== null) {
      this.element.style.height = `${this.height}px`;
    }
    this.grips.forEach((grip) => grip.setAttribute('aria-valuenow', String(this.height)));

    if (this.readout !== null) {
      this.readout.textContent = `${this.height}px`;
    }
  }

  /**
   * Snap the in-progress height so the dragged edge lands exactly on a sibling
   * column's block end when it comes close, and draw the guideline there.
   * Returns the height to apply (unchanged when nothing is in range).
   *
   * The moving edge's viewport position is derived from the FIXED edge (the one
   * not being dragged), which does not move during the gesture: dragging the
   * bottom keeps the top pinned, and vice versa.
   *
   * @param freeHeight - height the raw pointer delta asks for
   * @param edge - which edge is being dragged
   * @param targets - sibling block bottoms captured at gesture start
   * @param columnList - the enclosing column list the guide spans; null outside columns
   */
  private applySnap(
    freeHeight: number,
    edge: GripEdge,
    targets: number[],
    columnList: HTMLElement | null
  ): number {
    if (this.element === null || columnList === null || targets.length === 0) {
      return freeHeight;
    }

    const rect = this.element.getBoundingClientRect();
    const clamped = clampHeight(Math.round(freeHeight));
    // Where the dragged edge would sit at the requested height.
    const movingEdgeY = edge === 'bottom' ? rect.top + clamped : rect.bottom - clamped;
    const target = findSnapTarget(movingEdgeY, targets);

    if (target === null) {
      this.guide.hide();

      return freeHeight;
    }

    const snappedHeight = edge === 'bottom' ? target - rect.top : rect.bottom - target;
    // Only honour the snap if the aligned height is a legal one; otherwise the
    // guide would promise an alignment the clamp then refuses.
    if (snappedHeight !== clampHeight(Math.round(snappedHeight))) {
      this.guide.hide();

      return freeHeight;
    }

    this.guide.show(target, columnList.getBoundingClientRect(), columnList);

    return snappedHeight;
  }

  /**
   * Make the gap discoverable while editable: dashed accent outline on hover
   */
  private addHoverOutline(): void {
    this.element?.classList.add(...HOVER_OUTLINE_CLASSES);
  }

  /**
   * Show the resize chrome (outline, grips, readout) outright on a freshly
   * inserted spacer, and arm one-shot document listeners that put it back
   * behind the hover gate as soon as the user clicks or types elsewhere.
   */
  private revealFreshChrome(): void {
    if (this.element === null) {
      return;
    }

    this.element.setAttribute('data-blok-spacer-fresh', '');
    this.showChrome();

    const dismiss = (): void => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
      this.dismissFreshReveal = null;
      this.isFresh = false;

      this.element?.removeAttribute('data-blok-spacer-fresh');
      this.hideChrome();
    };

    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    this.dismissFreshReveal = dismiss;
  }

  /**
   * Force the chrome (outline, grips, readout) visible regardless of hover
   */
  private showChrome(): void {
    this.element?.classList.add(...PINNED_OUTLINE_CLASSES);
    [...this.grips, this.readout].forEach((node) => node?.classList.add('opacity-100'));
  }

  /**
   * Put the chrome back behind the hover gate
   */
  private hideChrome(): void {
    this.element?.classList.remove(...PINNED_OUTLINE_CLASSES);
    [...this.grips, this.readout].forEach((node) => node?.classList.remove('opacity-100'));
  }

  /**
   * Build the edge grips and the hover px readout
   */
  private attachGrips(): void {
    if (this.element === null) {
      return;
    }

    this.attachGrip('top');
    this.attachGrip('bottom');

    // Hover-only px readout. Decorative (aria-hidden) — the grips'
    // aria-valuenow carries the accessible value.
    const readout = document.createElement('span');

    readout.setAttribute('data-blok-spacer-readout', '');
    readout.setAttribute('aria-hidden', 'true');
    readout.textContent = `${this.height}px`;
    readout.className = twMerge(
      'absolute', 'right-2', 'top-1/2', '-translate-y-1/2',
      'text-xs', 'text-text-secondary', 'select-none', 'pointer-events-none',
      'opacity-0', 'transition-opacity', 'group-hover/spacer:opacity-100'
    );

    this.element.appendChild(readout);
    this.readout = readout;
  }

  /**
   * Build one edge grip: a keyboard-focusable separator that resizes the gap
   * by pointer drag or arrow keys (mirrors the column resizer a11y). Dragging
   * moves that edge: pulling the bottom edge down or the top edge up grows
   * the gap. On direct hover the pill turns accent-blue and widens so the
   * zone reads as draggable.
   *
   * @param edge - which edge of the spacer the grip controls
   */
  private attachGrip(edge: GripEdge): void {
    if (this.element === null) {
      return;
    }

    // Pointer delta sign: the bottom edge follows the pointer, the top edge
    // moves against it (dragging the top edge up makes the gap taller).
    const direction = edge === 'bottom' ? 1 : -1;

    const grip = document.createElement('div');

    grip.setAttribute('data-blok-spacer-grip', edge);
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', this.api.i18n.t('tools.spacer.resizeAriaLabel'));
    grip.setAttribute('aria-valuemin', String(MIN_HEIGHT));
    grip.setAttribute('aria-valuemax', String(MAX_HEIGHT));
    grip.setAttribute('aria-valuenow', String(this.height));
    grip.setAttribute('tabindex', '0');
    grip.className = twMerge(
      'absolute', 'inset-x-0', 'h-2', 'cursor-ns-resize',
      edge === 'bottom' ? 'bottom-0' : 'top-0',
      'opacity-0', 'transition-opacity',
      'group-hover/spacer:opacity-100', 'focus-visible:opacity-100',
      // The pill: a capsule centered ON the edge line (half in, half out),
      // ringed with the surface color so the dashed outline visibly breaks
      // behind it instead of cutting through it.
      'after:absolute', 'after:left-1/2', 'after:-translate-x-1/2',
      edge === 'bottom' ? 'after:bottom-0 after:translate-y-1/2' : 'after:top-0 after:-translate-y-1/2',
      'after:h-2.5', 'after:w-10', 'after:rounded-full', 'after:bg-(--blok-color-accent)',
      'after:border-2', 'after:border-solid', 'after:border-popover-bg', 'after:shadow-sm',
      'after:transition-all', 'hover:after:w-14'
    );

    grip.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Arrow keys move the grip's edge: down = edge down, up = edge up.
      const delta = (event.key === 'ArrowDown' ? KEYBOARD_STEP : -KEYBOARD_STEP) * direction;

      this.setHeight(this.height + delta);
    });

    grip.addEventListener('pointerdown', (event: PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = this.height;

      // Pin the chrome for the whole gesture — mid-drag the pointer easily
      // leaves the block, and losing the hover state would make the spacer
      // vanish while the user is resizing it.
      this.element?.setAttribute('data-blok-spacer-dragging', '');
      this.showChrome();

      // Snapshot the sibling columns' block ends once, at gesture start: the
      // dragged edge pushes this column's own content around, but the blocks
      // we align against are in OTHER columns and hold still.
      const snapTargets = this.element === null ? [] : collectSiblingBlockBottoms(this.element);
      const columnList = this.element?.closest<HTMLElement>(`[${COLUMNS_ATTR}]`) ?? null;

      const onMove = (move: PointerEvent): void => {
        const freeHeight = startHeight + (move.clientY - startY) * direction;
        const snapped = this.applySnap(freeHeight, edge, snapTargets, columnList);

        this.setHeight(snapped);
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        this.guide.hide();
        this.element?.removeAttribute('data-blok-spacer-dragging');
        this.hideChrome();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    this.element.appendChild(grip);
    this.grips.push(grip);
  }
}
