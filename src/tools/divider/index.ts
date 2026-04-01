import type {
  BlockTool,
  BlockToolConstructorOptions,
  PasteConfig,
  SanitizerConfig,
  ToolboxConfig,
} from '../../../types';
import type { DividerData } from './types';
import { IconDivider } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';

/**
 * Divider block tool — renders a thin horizontal line separator.
 * Contentless void block with no editable content or settings.
 */
export class DividerTool implements BlockTool {
  /**
   * Rendered wrapper element
   */
  private element: HTMLElement | null = null;

  /**
   * @param _options - block tool constructor options (unused for divider)
   */
  constructor(_options: BlockToolConstructorOptions<DividerData>) {}

  /**
   * Render a wrapper with a semantic <hr> element inside.
   * Wrapper uses padding for spacing and minimal line-height so the
   * toolbar positioning algorithm centers correctly on the divider line.
   */
  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.className = twMerge('py-3', 'leading-[1px]');

    const hr = document.createElement('hr');

    hr.className = twMerge('border-t', 'border-border-primary', 'border-b-0', 'border-l-0', 'border-r-0');
    wrapper.appendChild(hr);
    this.element = wrapper;

    return wrapper;
  }

  /**
   * Return empty data — divider has no content
   */
  public save(): DividerData {
    return {} as DividerData;
  }

  /**
   * Always valid — nothing to validate
   */
  public validate(_data: DividerData): boolean {
    return true;
  }

  /**
   * Toolbox appearance
   */
  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconDivider,
      titleKey: 'divider',
      shortcut: '---',
      searchTerms: ['hr', 'line', 'separator', 'rule', '---'],
    };
  }

  /**
   * Divider works in read-only mode
   */
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Paste three-or-more hyphens to create a divider
   */
  public static get pasteConfig(): PasteConfig {
    return {
      patterns: {
        divider: /^-{3,}$/,
      },
    };
  }

  /**
   * Nothing to sanitize — no HTML content
   */
  public static get sanitize(): SanitizerConfig {
    return {};
  }
}
