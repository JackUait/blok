import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../shared/tool-descriptions/inline';
import type { API, InlineTool } from '../../../types';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR } from '../constants/data-attributes';
import { IconChevronDown, IconRose } from '../icons';
import { assistantActions } from '../modules/assistant/actions';
import { dressSkillIcon } from '../modules/assistant/skill-icons';
import { generateBlockId } from '../utils/id-generator';
import { css as popoverItemCls } from '../utils/popover/components/popover-item/popover-item-default/popover-item-default.const';
import { PopoverItemType } from '../utils/popover';
import { twMerge } from '../utils/tw';

// Same hover and keyboard-focus tints as the toolbar's own cells.
const BUTTON = 'flex items-center gap-2 h-7 px-2 rounded-(--blok-radius-inner,var(--blok-radius-control)) text-popover-item-label bg-transparent border-none outline-hidden select-none can-hover:hover:cursor-pointer can-hover:hover:bg-item-hover-bg data-[blok-focused="true"]:bg-item-focus-bg mobile:h-10';

const SVG_NS = 'http://www.w3.org/2000/svg';

const svgElement = (tag: 'path' | 'stop', attributes: Record<string, string>): SVGElement => {
  const element = document.createElementNS(SVG_NS, tag);

  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));

  return element;
};

/** Adds a gradient to `svg` and returns its paint. CSS walks its stops through the AI hues. The id is unique per icon. */
const addGradient = (svg: SVGSVGElement): string => {
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');

  gradient.id = `blok-ask-ai-hue-${generateBlockId()}`;
  ['x1', 'y1', 'x2', 'y2'].forEach((key, index) => gradient.setAttribute(key, index < 2 ? '0' : '1'));
  ['0', '0.5', '1'].forEach((offset) => gradient.append(svgElement('stop', { offset })));
  svg.append(gradient);

  return `url(#${gradient.id})`;
};

/** The bar's light on the rose. The bar's own CSS hides it until ask-ai-menu.css shows it on hover. */
const addLight = (svg: SVGSVGElement): void => {
  const rose = svg.querySelector('path');

  svg.append(svgElement('path', {
    d: rose?.getAttribute('d') ?? '',
    pathLength: '100',
    fill: 'none',
    stroke: addGradient(svg),
    'data-blok-assistant-light': '',
  }));
};

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
    const open = this.button(IconRose, t('assistant.label'), () => this.run());
    const toggle = document.createElement('button');
    const skills = document.createElement('div');
    const rose = open.querySelector('svg');

    root.className = 'flex flex-col w-full';
    root.setAttribute('data-blok-ask-ai', '');
    row.className = 'flex items-center gap-1';
    open.className = `${BUTTON} flex-1 min-w-0`;
    open.setAttribute('data-blok-ask-ai-open', '');
    if (rose) {
      addLight(rose);
    }

    toggle.type = 'button';
    toggle.setAttribute('role', 'menuitem');
    toggle.className = `${BUTTON} justify-center w-7 px-0 mobile:w-10 text-text-secondary [&[aria-expanded=true]_svg]:rotate-180 [&_svg]:transition-transform [&_svg]:w-icon [&_svg]:h-icon`;
    toggle.setAttribute('aria-label', t('assistant.actions'));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('data-blok-ask-ai-toggle', '');
    toggle.innerHTML = IconChevronDown;

    skills.className = 'flex flex-col pt-1';
    skills.setAttribute('data-blok-ask-ai-skills', '');
    skills.hidden = true;
    skills.append(...assistantActions('selection', t).map(({ label, prompt, icon }, index) => {
      const skill = this.button(icon === undefined ? undefined : dressSkillIcon(icon), label, () => this.run(prompt));

      // The card is five cells wide, so a long label wraps.
      skill.className = `${BUTTON} h-auto min-h-7 py-0.5 text-left`;
      skill.setAttribute('data-blok-ask-ai-skill', '');
      skill.style.setProperty('--blok-ask-ai-index', String(index));

      return skill;
    }));

    toggle.addEventListener('click', () => {
      skills.hidden = !skills.hidden;
      toggle.setAttribute('aria-expanded', String(!skills.hidden));
    });

    row.append(open, toggle);
    root.append(row, skills);

    // The popover mounts the item after render; the rule above it then exists.
    requestAnimationFrame(() => {
      const rule = root.parentElement?.previousElementSibling;

      if (rule?.hasAttribute(DATA_ATTR.popoverItemSeparator) === true) {
        rule.querySelector(`[${DATA_ATTR.popoverItemSeparatorLine}]`)?.setAttribute('data-blok-ask-ai-seam', '');
      }
    });

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
    const text = document.createElement('span');

    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.className = BUTTON;
    // Grid stacks a skill's ink icon and its coloured copy. A host's own .flex would beat a CSS rule.
    glyph.className = twMerge(popoverItemCls.icon, 'grid place-items-center');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.setAttribute('data-blok-ask-ai-glyph', '');
    // Icons are Blok's own SVG constants, never host input.
    glyph.innerHTML = icon ?? '';
    text.setAttribute('data-blok-ask-ai-label', '');
    text.textContent = label;
    button.append(glyph, text);
    button.addEventListener('click', onClick);

    return button;
  }
}
