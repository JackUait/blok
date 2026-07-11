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

/**
 * Height bounds and default (px). The minimum keeps the block grabbable;
 * the maximum stops a stray drag from swallowing the page.
 */
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 24;

/**
 * Keyboard resize step for ArrowUp/ArrowDown on the grip (px).
 */
const KEYBOARD_STEP = 8;

const clampHeight = (value: number): number => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value));

/**
 * Spacer block tool — an adjustable vertical gap.
 *
 * Stores a single `height` in px. Drag the bottom-edge grip (or focus it and
 * press ArrowUp/ArrowDown) to resize. Its main job is lining up content across
 * sibling columns of unequal length, replacing piles of empty paragraphs.
 */
export class SpacerTool implements BlockTool {
  /**
   * Rendered wrapper element
   */
  private element: HTMLElement | null = null;

  /**
   * Resize grip on the bottom edge; absent in read-only mode
   */
  private grip: HTMLElement | null = null;

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
   * Blok API for i18n
   */
  private api: API;

  /**
   * @param options - block tool constructor options
   */
  constructor(options: BlockToolConstructorOptions<SpacerData>) {
    this.api = options.api;
    this.readOnly = options.readOnly;
    this.height = clampHeight(typeof options.data.height === 'number' ? options.data.height : DEFAULT_HEIGHT);
  }

  /**
   * Render the gap: an empty wrapper whose inline height IS the content,
   * plus a resize grip on its bottom edge when editable.
   */
  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-spacer', '');
    // The gap is invisible content — the hover outline + px readout are what
    // make it discoverable as a real, resizable block instead of plain margin.
    wrapper.className = twMerge(
      'relative', 'group/spacer', 'rounded-md',
      'hover:outline-dashed', 'hover:outline-1', 'hover:outline-border-primary'
    );
    wrapper.style.height = `${this.height}px`;
    this.element = wrapper;

    if (!this.readOnly) {
      this.attachGrip();
    }

    return wrapper;
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
   * Toggle read-only in place by adding/removing the resize grip
   */
  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    if (state) {
      this.grip?.remove();
      this.grip = null;
      this.readout?.remove();
      this.readout = null;
    } else if (this.element !== null && this.grip === null) {
      this.attachGrip();
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
   * Spacer works in read-only mode (renders the gap, hides the grip)
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
   * Apply a new height to the element and keep the grip's aria value in sync.
   * The inline style mutation is inside the observed block subtree, so the
   * change reaches the Saver/undo pipeline via the regular MutationObserver.
   */
  private setHeight(value: number): void {
    this.height = clampHeight(Math.round(value));

    if (this.element !== null) {
      this.element.style.height = `${this.height}px`;
    }
    this.grip?.setAttribute('aria-valuenow', String(this.height));

    if (this.readout !== null) {
      this.readout.textContent = `${this.height}px`;
    }
  }

  /**
   * Build the bottom-edge grip: a keyboard-focusable separator that resizes
   * the gap by pointer drag or arrow keys (mirrors the column resizer a11y).
   */
  private attachGrip(): void {
    if (this.element === null) {
      return;
    }

    const grip = document.createElement('div');

    grip.setAttribute('data-blok-spacer-grip', '');
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', this.api.i18n.t('tools.spacer.resizeAriaLabel'));
    grip.setAttribute('aria-valuemin', String(MIN_HEIGHT));
    grip.setAttribute('aria-valuemax', String(MAX_HEIGHT));
    grip.setAttribute('aria-valuenow', String(this.height));
    grip.setAttribute('tabindex', '0');
    grip.className = twMerge(
      'absolute', 'inset-x-0', 'bottom-0', 'h-2', 'cursor-ns-resize',
      'opacity-0', 'transition-opacity',
      'group-hover/spacer:opacity-100', 'focus-visible:opacity-100',
      'after:absolute', 'after:left-1/2', 'after:-translate-x-1/2', 'after:bottom-0',
      'after:h-1', 'after:w-8', 'after:rounded-full', 'after:bg-border-primary'
    );

    grip.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.setHeight(this.height + (event.key === 'ArrowDown' ? KEYBOARD_STEP : -KEYBOARD_STEP));
    });

    grip.addEventListener('pointerdown', (event: PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = this.height;

      const onMove = (move: PointerEvent): void => {
        this.setHeight(startHeight + (move.clientY - startY));
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    this.element.appendChild(grip);
    this.grip = grip;

    // Hover-only px readout. Decorative (aria-hidden) — the grip's
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
}
