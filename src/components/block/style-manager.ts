import { twMerge } from '../utils/tw';
import { DATA_ATTR } from '../constants';

/**
 * Manages block visual state including stretched mode and CSS classes.
 * Centralizes style constants and provides class name computation.
 */
export class StyleManager {
  /**
   * Tailwind styles for the Block elements
   */
  private static readonly styles = {
    wrapper: 'relative opacity-100 my-[-0.5em] py-[0.5em] first:mt-0 [&_a]:cursor-pointer [&_a]:underline [&_a]:text-link [&_b]:font-bold [&_i]:italic',
    content: 'relative mx-auto transition-colors duration-150 ease-out max-w-content',
    contentSelected: 'bg-selection rounded-[4px] [&_[contenteditable]]:select-none [&_img]:opacity-55 [&_[data-blok-tool=stub]]:opacity-55',
    contentStretched: 'max-w-none',
  };

  /**
   * @param holder - Block's holder element
   * @param contentElement - Content wrapper element (can be null initially)
   */
  constructor(
    private readonly holder: HTMLDivElement,
    private readonly contentElement: HTMLElement | null
  ) {}

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
    if (selected) {
      return twMerge(StyleManager.styles.content, StyleManager.styles.contentSelected);
    }

    if (stretched) {
      return twMerge(StyleManager.styles.content, StyleManager.styles.contentStretched);
    }

    return StyleManager.styles.content;
  }
}
