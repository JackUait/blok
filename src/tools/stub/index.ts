import $ from '../../components/dom';
import type { API, BlockTool, BlockToolConstructorOptions, BlockToolData } from '../../../types';
import { IconWarning } from '../../components/icons';
import { DATA_ATTR } from '../../components/constants';

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
    const wrapper = $.make('div', 'flex items-center py-3 px-[18px] my-2.5 rounded-[10px] bg-bg-light border border-line-gray text-gray-text text-sm [&_svg]:size-icon');
    const icon = IconWarning;
    const infoContainer = $.make('div', 'ml-3.5');
    const title = $.make('div', 'font-medium capitalize', {
      textContent: this.title,
    });
     
    const subtitle = $.make('div', '', {
      textContent: this.subtitle,
    });

    wrapper.setAttribute(DATA_ATTR.tool, 'stub');
    wrapper.setAttribute(DATA_ATTR.stub, '');
    infoContainer.setAttribute(DATA_ATTR.stubInfo, '');
    title.setAttribute(DATA_ATTR.stubTitle, '');
    subtitle.setAttribute(DATA_ATTR.stubSubtitle, '');

    wrapper.innerHTML = icon;

    infoContainer.appendChild(title);
    infoContainer.appendChild(subtitle);

    wrapper.appendChild(infoContainer);

    return wrapper;
  }
}
