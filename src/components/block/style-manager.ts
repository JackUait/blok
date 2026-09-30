import { BLOCK_CONTENT_CLASSES, BLOCK_WRAPPER_CLASSES } from '../../shared/block-scaffolding';
import { DATA_ATTR } from '../constants';
import { twMerge } from '../utils/tw';

/**
 * Manages block visual state including stretched mode and CSS classes.
 * Centralizes style constants and provides class name computation.
 */
export class StyleManager {
  /**
   * Tailwind styles for the Block elements
   */
  private static readonly styles = {
    /**
     * Single-sourced in `src/shared/block-scaffolding.ts` so the view renderer
     * reproduces this scaffolding exactly — the inline appearance of links,
     * bold and italic in every block comes from the wrapper's descendant
     * selectors here, not from any tool's own classes.
     */
    wrapper: BLOCK_WRAPPER_CLASSES.join(' '),
    content: BLOCK_CONTENT_CLASSES.join(' '),
    /**
     * The fill is the content wrapper, which has no padding, so the gap to a
     * framed tool's corner is 0 and the fill radius is the frame radius itself.
     */
    contentSelected: 'bg-selection rounded-(--blok-radius-frame,var(--blok-radius-control)) **:[[contenteditable]]:select-none [&_img]:opacity-55 **:data-[blok-tool=stub]:opacity-55',
    contentStretched: 'max-w-none',
  };

  /**
   * @param holder - Block's holder element
   * @param contentElement - Content wrapper element (can be null initially)
   * @param frameRadius - radius of the tool's rounded frame, if it has one
   */
  constructor(
    private readonly holder: HTMLDivElement,
    private readonly contentElement: HTMLElement | null,
    frameRadius?: string
  ) {
    if (frameRadius !== undefined) {
      this.contentElement?.style.setProperty('--blok-radius-frame', frameRadius);
    }
  }

  /**
   * Get wrapper styles
   */
  public static get wrapperStyles(): string {
    return StyleManager.styles.wrapper;
  }

  /**
   * Get base content styles
   */
  public static get contentStyles(): string {
    return StyleManager.styles.content;
  }

  /**
   * Set stretched state with optional selection state consideration
   * @param state - true to enable stretched mode
   * @param selected - current selection state (optional)
   */
  public setStretchState(state: boolean, selected = false): void {
    if (state) {
      this.holder.setAttribute(DATA_ATTR.stretched, 'true');
    } else {
      this.holder.removeAttribute(DATA_ATTR.stretched);
    }

    // Only update content classes if not selected (selection takes precedence)
    if (this.contentElement && !selected) {
      this.updateContentState(false, state);
    }
  }

  /**
   * Get stretched state
   */
  public get stretched(): boolean {
    return this.holder.getAttribute(DATA_ATTR.stretched) === 'true';
  }

  /**
   * Update content element CSS classes based on selected and stretched state
   * @param selected - whether block is selected
   * @param stretched - whether block is stretched
   */
  public updateContentState(selected: boolean, stretched: boolean): void {
    if (!this.contentElement) {
      return;
    }

    this.contentElement.className = this.getContentClasses(selected, stretched);
  }

  /**
   * Compute content element CSS classes based on state
   * @param selected - whether block is selected
   * @param stretched - whether block is stretched
   * @returns The CSS class string
   */
  public getContentClasses(selected: boolean, stretched: boolean): string {
    if (selected && stretched) {
      return twMerge(StyleManager.styles.content, StyleManager.styles.contentSelected, StyleManager.styles.contentStretched);
    }

    if (selected) {
      return twMerge(StyleManager.styles.content, StyleManager.styles.contentSelected);
    }

    if (stretched) {
      return twMerge(StyleManager.styles.content, StyleManager.styles.contentStretched);
    }

    return StyleManager.styles.content;
  }
}
