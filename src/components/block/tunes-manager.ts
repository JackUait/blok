import type { BlockAPI as BlockAPIInterface } from '../../../types/api';
import type { BlockTune as IBlockTune } from '../../../types';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { BlockTuneAdapter } from '../tools/tune';
import type { ToolsCollection } from '../tools/collection';
import type { MenuConfigItem } from '../../../types/tools';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { Dom as $ } from '../dom';
import { isFunction, log } from '../utils';

/**
 * Manages block tunes for a Block instance.
 * Handles tune instantiation, menu configuration, content wrapping, and data extraction.
 */
export class TunesManager {
  /**
   * User provided Block Tunes instances
   */
  private readonly tunesInstances: Map<string, IBlockTune> = new Map();

  /**
   * Blok provided Block Tunes instances
   */
  private readonly defaultTunesInstances: Map<string, IBlockTune> = new Map();

  /**
   * If there is saved data for Tune which is not available at the moment,
   * we will store it here and provide back on save so data is not lost
   */
  private unavailableTunesData: { [name: string]: BlockTuneData } = {};

  /**
   * @param tunes - Collection of tune adapters
   * @param tunesData - Initial tunes data for each tune
   * @param blockAPI - Block API to pass to tune instances
   */
  constructor(
    private readonly tunes: ToolsCollection<BlockTuneAdapter>,
    tunesData: { [name: string]: BlockTuneData },
    private readonly blockAPI: BlockAPIInterface
  ) {
    this.composeTunes(tunesData);
  }

  /**
   * Returns menu configuration for Block Tunes popover.
   * Splits tunes into tool-specific (from tool's renderSettings) and common tunes.
   *
   * @param toolRenderSettings - Optional render settings from the tool
   * @returns Object with toolTunes and commonTunes arrays
   */
  public getMenuConfig(toolRenderSettings?: MenuConfigItem | MenuConfigItem[] | HTMLElement): {
    toolTunes: PopoverItemParams[];
    commonTunes: PopoverItemParams[];
  } {
    const toolTunesPopoverParams: PopoverItemParams[] = [];
    const commonTunesPopoverParams: PopoverItemParams[] = [];

    const pushTuneConfig = (
      tuneConfig: MenuConfigItem | MenuConfigItem[] | HTMLElement | undefined,
      target: PopoverItemParams[]
    ): void => {
      if (!tuneConfig) {
        return;
      }

      if ($.isElement(tuneConfig)) {
        target.push({
          type: PopoverItemType.Html,
          element: tuneConfig,
        });

        return;
      }

      if (Array.isArray(tuneConfig)) {
        target.push(...tuneConfig);

        return;
      }

      target.push(tuneConfig);
    };

    /** Tool's tunes: may be defined as return value of optional renderSettings method */
    const tunesDefinedInTool = toolRenderSettings;

    pushTuneConfig(tunesDefinedInTool, toolTunesPopoverParams);

    /** Common tunes: combination of default tunes (move up, move down, delete) and third-party tunes connected via tunes api */
    const commonTunes = [
      ...this.tunesInstances.values(),
      ...this.defaultTunesInstances.values(),
    ].map(tuneInstance => tuneInstance.render());

    /** Separate custom html from Popover items params for common tunes */
    commonTunes.forEach(tuneConfig => {
      pushTuneConfig(tuneConfig, commonTunesPopoverParams);
    });

    return {
      toolTunes: toolTunesPopoverParams,
      commonTunes: commonTunesPopoverParams,
    };
  }

  /**
   * Wraps the content node with tune wrappers.
   * Tunes can optionally wrap block content to provide UI changes.
   *
   * @param contentNode - The content node to wrap
   * @returns The wrapped content node
   */
  public wrapContent(contentNode: HTMLElement): HTMLElement {
    /**
     * Block Tunes might wrap Block's content node to provide any UI changes
     *
     * <tune2wrapper>
     *   <tune1wrapper>
     *     <blockContent />
     *   </tune1wrapper>
     * </tune2wrapper>
     */
    return [...this.tunesInstances.values(), ...this.defaultTunesInstances.values()]
      .reduce((acc, tune) => {
        if (isFunction(tune.wrap)) {
          try {
            return tune.wrap(acc);
          } catch (e) {
            log(`Tune ${tune.constructor.name} wrap method throws an Error %o`, 'warn', e);

            return acc;
          }
        }

        return acc;
      }, contentNode);
  }

  /**
   * Extracts current tune data for persistence.
   * Includes data from both user and default tunes, plus unavailable tune data.
   *
   * @returns Object mapping tune names to their data
   */
  public extractTunesData(): { [name: string]: BlockTuneData } {
    const tunesData: { [name: string]: BlockTuneData } = { ...this.unavailableTunesData };

    [
      ...this.tunesInstances.entries(),
      ...this.defaultTunesInstances.entries(),
    ]
      .forEach(([name, tune]) => {
        if (isFunction(tune.save)) {
          try {
            tunesData[name] = tune.save();
          } catch (e) {
            log(`Tune ${tune.constructor.name} save method throws an Error %o`, 'warn', e);
          }
        }
      });

    return tunesData;
  }

  /**
   * Returns user tune instances map
   */
  public get userTunes(): Map<string, IBlockTune> {
    return this.tunesInstances;
  }

  /**
   * Returns default (internal) tune instances map
   */
  public get defaultTunes(): Map<string, IBlockTune> {
    return this.defaultTunesInstances;
  }

  /**
   * Instantiate Block Tunes from tune adapters
   * @param tunesData - current Block tunes data
   * @private
   */
  private composeTunes(tunesData: { [name: string]: BlockTuneData }): void {
    Array.from(this.tunes.values()).forEach((tune) => {
      const collection = tune.isInternal ? this.defaultTunesInstances : this.tunesInstances;

      collection.set(tune.name, tune.create(tunesData[tune.name], this.blockAPI));
    });

    /**
     * Check if there is some data for not available tunes
     */
    Object.entries(tunesData).forEach(([name, data]) => {
      if (!this.tunesInstances.has(name)) {
        this.unavailableTunesData[name] = data;
      }
    });
  }
}
