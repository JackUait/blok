import type { API, BlockTool, BlockToolConstructorOptions, BlockToolData } from '../../../types';
import { DATA_ATTR } from '../../components/constants';
import { Dom as $ } from '../../components/dom';

export interface StubData extends BlockToolData {
  title: string;
  savedData: BlockToolData;
}

/**
 * This tool will be shown in place of a block without corresponding plugin
 * It will store its data inside and pass it back with article saving
 */
export class Stub implements BlockTool {
  /**
   * Notify core that tool supports read-only mode
   */
  public static isReadOnlySupported = true;

  public static frameRadius = 'var(--blok-radius-block)';

  /**
   * Main stub wrapper
   */
  private readonly wrapper: HTMLElement;

  /**
   * Blok API
   */
  private readonly api: API;

  /**
   * Stub title — tool name
   */
  private readonly title: string;

  /**
   * Stub hint
   */
  private readonly subtitle: string;

  /**
   * Original Tool data
   */
  private readonly savedData: BlockToolData;

  /**
   * @param options - constructor options
   * @param options.data - stub tool data
   * @param options.api - Blok API
   */
  constructor({ data, api }: BlockToolConstructorOptions<StubData>) {
    this.api = api;
    this.title = data.title || this.api.i18n.t('tools.stub.error');
    this.subtitle = this.api.i18n.t('tools.stub.blockCannotBeDisplayed');
    this.savedData = data.savedData;

    this.wrapper = this.make();
  }

  /**
   * Returns stub holder
   * @returns {HTMLElement}
   */
  public render(): HTMLElement {
    return this.wrapper;
  }

  /**
   * Return a deep copy of the original Tool data.
   *
   * Must never return the retained `savedData` by reference: the saver pushes
   * this object straight into the `editor.save()` output, so an aliased return
   * would let a consumer mutating the save result corrupt subsequent saves.
   * @returns {BlockToolData}
   */
  public save(): BlockToolData {
    try {
      return structuredClone(this.savedData);
    } catch {
      // Data carrying non-cloneable values (e.g. functions) falls back to a
      // shallow copy, which at least detaches the top-level object.
      return { ...this.savedData };
    }
  }

  /**
   * Toggle read-only mode in-place.
   * Stub has no interactive elements, so this is intentionally a no-op.
   *
   * @param _state - read-only state (unused)
   */
  public setReadOnly(_state: boolean): void {
    // no-op: stub blocks have no editable content
  }

  /**
   * Create Tool html markup
   * @returns {HTMLElement}
   */
  private make(): HTMLElement {
    const wrapper = $.make('div', 'flex flex-wrap items-center gap-2.5 py-2.25 px-3 my-2.5 rounded-(--blok-radius-block) border-[1.5px] border-dashed border-(--blok-border-strong) bg-[repeating-linear-gradient(135deg,transparent_0_9px,var(--blok-stub-hatch)_9px_10px)] text-sm leading-normal text-(--blok-text-secondary)');
    const infoContainer = $.make('div', 'min-w-0 flex-1');
    const title = $.make('div', 'flex-none max-w-full truncate py-[3px] px-[7px] rounded-(--blok-radius-control) border border-(--blok-border-primary) bg-(--blok-bg-primary) font-mono font-medium text-xs leading-normal text-(--blok-text-primary)', {
      textContent: this.title,
    });
    const subtitle = $.make('div', '', {
      textContent: this.subtitle,
    });

    wrapper.setAttribute(DATA_ATTR.tool, 'stub');
    wrapper.setAttribute(DATA_ATTR.stub, '');
    // "This block cannot be displayed" is information, not an interruption, so
    // the placeholder is a polite status rather than an alert.
    wrapper.setAttribute('role', 'status');
    infoContainer.setAttribute(DATA_ATTR.stubInfo, '');
    title.setAttribute(DATA_ATTR.stubTitle, '');
    subtitle.setAttribute(DATA_ATTR.stubSubtitle, '');

    infoContainer.appendChild(subtitle);

    wrapper.appendChild(title);

    wrapper.appendChild(infoContainer);

    return wrapper;
  }
}
