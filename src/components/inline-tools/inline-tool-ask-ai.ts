import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../shared/tool-descriptions/inline';
import type { API, InlineTool } from '../../../types';
import type { MenuConfig } from '../../../types/tools';
import { IconChevronDown, IconEmojiSparkles } from '../icons';
import { assistantActions } from '../modules/assistant/actions';
import { css as popoverItemCls } from '../utils/popover/components/popover-item/popover-item-default/popover-item-default.const';
import { PopoverItemType } from '../utils/popover';

// Same hover and keyboard-focus tints as the toolbar's own cells.
const BUTTON = 'flex items-center gap-2 h-7 px-2 rounded-(--blok-radius-inner,var(--blok-radius-control)) text-popover-item-label bg-transparent border-none outline-hidden select-none can-hover:hover:cursor-pointer can-hover:hover:bg-item-hover-bg data-[blok-focused="true"]:bg-item-focus-bg mobile:h-10';

/**
 * "Ask AI" in the inline toolbar: the card's last row. The button opens the
 * assistant prompt bar about the selected text; the toggle folds out the
 * built-in skills, each of which opens the bar and sends its prompt at once.
 * Registered only when `agent.assistant` is configured.
 */
export class AskAiInlineTool implements InlineTool {
  public static describe = BUILT_IN_INLINE_DESCRIPTIONS.askAi;

  public static isInline = true;

  public static title = 'Ask AI';

  public static titleKey = 'askAi';

  private readonly api: API;

  /**
   * @param options - tool options
   * @param options.api - editor API
   */
  constructor({ api }: { api: API }) {
    this.api = api;
  }

  public render(): MenuConfig {
    const t = (key: string): string => this.api.i18n.t(key);
    const root = document.createElement('div');
    const row = document.createElement('div');
    const open = this.button(IconEmojiSparkles, t('assistant.label'), () => this.run());
    const toggle = document.createElement('button');
    const skills = document.createElement('div');

    root.className = 'flex flex-col w-full';
    row.className = 'flex items-center gap-1';
    open.className = `${BUTTON} flex-1 min-w-0`;

    toggle.type = 'button';
    toggle.setAttribute('role', 'menuitem');
    toggle.className = `${BUTTON} justify-center w-7 px-0 mobile:w-10 text-text-secondary [&[aria-expanded=true]_svg]:rotate-180 [&_svg]:transition-transform [&_svg]:w-icon [&_svg]:h-icon`;
    toggle.setAttribute('aria-label', t('assistant.actions'));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = IconChevronDown;

    skills.className = 'flex flex-col pt-1';
    skills.hidden = true;
    skills.append(...assistantActions('selection', t).map(({ label, prompt, icon }) => {
      const skill = this.button(icon, label, () => this.run(prompt));

      // The card is five cells wide, so a long label wraps.
      skill.className = `${BUTTON} h-auto min-h-7 py-1 text-left`;
      skill.setAttribute('data-blok-ask-ai-skill', '');

      return skill;
    }));

    toggle.addEventListener('click', () => {
      skills.hidden = !skills.hidden;
      toggle.setAttribute('aria-expanded', String(!skills.hidden));
    });

    row.append(open, toggle);
    root.append(row, skills);

    return { type: PopoverItemType.Html, element: root, name: 'askAi' };
  }

  /** Opens the bar, with a skill's prompt if given. The bar reads the selection before the toolbar closes. */
  private run(prompt?: string): void {
    if (prompt === undefined) {
      this.api.agent?.openAssistant();
    } else {
      this.api.agent?.openAssistant({ prompt });
    }
    this.api.inlineToolbar.close();
  }

  private button(icon: string | undefined, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    const glyph = document.createElement('span');

    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = BUTTON;
    glyph.className = popoverItemCls.icon;
    glyph.setAttribute('aria-hidden', 'true');
    // Icons are Blok's own SVG constants, never host input.
    glyph.innerHTML = icon ?? '';
    button.append(glyph, label);
    button.addEventListener('click', onClick);

    return button;
  }
}
