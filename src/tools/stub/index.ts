import $ from '../../components/dom';
import type { API, BlockTool, BlockToolConstructorOptions, BlockToolData } from '../../../types';
import { IconWarning } from '../../components/icons';

export interface StubData extends BlockToolData {
  title: string;
  savedData: BlockToolData;
}

/**
 * This tool will be shown in place of a block without corresponding plugin
 * It will store its data inside and pass it back with article saving
 */
export default class Stub implements BlockTool {
  /**
   * Notify core that tool supports read-only mode
   */
  public static isReadOnlySupported = true;

  /**
   * Stub styles
   * @type {{wrapper: string, info: string, title: string, subtitle: string}}
   */
  private CSS = {
    wrapper: 'blok-stub flex items-center py-3 px-[18px] my-2.5 rounded-[10px] bg-bg-light border border-line-gray text-gray-text text-sm [&_svg]:size-icon',
    info: 'blok-stub__info ml-3.5',
    title: 'blok-stub__title font-medium capitalize',
    subtitle: 'blok-stub__subtitle',
  };

  /**
   * Data attributes for testing
   */
  private static readonly DATA_ATTR = {
    wrapper: 'data-blok-stub',
    title: 'data-blok-stub-title',
    subtitle: 'data-blok-stub-subtitle',
  };

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
    this.title = data.title || this.api.i18n.t('Error');
    this.subtitle = this.api.i18n.t('The block can not be displayed correctly.');
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
   * Return original Tool data
   * @returns {BlockToolData}
   */
  public save(): BlockToolData {
    return this.savedData;
  }

  /**
   * Create Tool html markup
   * @returns {HTMLElement}
   */
  private make(): HTMLElement {
    const wrapper = $.make('div', this.CSS.wrapper);
    const icon = IconWarning;
    const infoContainer = $.make('div', this.CSS.info);
    const title = $.make('div', this.CSS.title, {
      textContent: this.title,
    });
    const subtitle = $.make('div', this.CSS.subtitle, {
      textContent: this.subtitle,
    });

    wrapper.setAttribute(Stub.DATA_ATTR.wrapper, '');
    title.setAttribute(Stub.DATA_ATTR.title, '');
    subtitle.setAttribute(Stub.DATA_ATTR.subtitle, '');

    wrapper.innerHTML = icon;

    infoContainer.appendChild(title);
    infoContainer.appendChild(subtitle);

    wrapper.appendChild(infoContainer);

    return wrapper;
  }
}
