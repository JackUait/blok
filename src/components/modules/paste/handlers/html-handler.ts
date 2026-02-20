import type { SanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { Dom as dom$ } from '../../../dom';
import type { BlockToolAdapter } from '../../../tools/block';
import { isObject } from '../../../utils';
import { clean } from '../../../utils/sanitizer';
import { SAFE_STRUCTURAL_TAGS, collectTagNames } from '../constants';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PasteData } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';


/**
 * HTML Handler Priority.
 * Handles HTML string content.
 */
export class HtmlHandler extends BasePasteHandler implements PasteHandler {
  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string') {
      return 0;
    }

    if (!data.trim() || !dom$.isHTMLString(data)) {
      return 0;
    }

    return 40;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const dataToInsert = this.processHTML(data);

    if (!dataToInsert.length) {
      return false;
    }

    await this.insertPasteData(dataToInsert, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * Split HTML string to blocks and return it as array of Block data.
   */
  private processHTML(innerHTML: string): PasteData[] {
    const { Tools } = this.Blok;

    const wrapper = dom$.make('DIV');

    wrapper.innerHTML = innerHTML;

    const nodes = this.getNodes(wrapper);

    return nodes
      .map((node) => {
        const nodeData = (() => {
          switch (node.nodeType) {
            case Node.DOCUMENT_FRAGMENT_NODE: {
              const fragmentWrapper = dom$.make('div');

              fragmentWrapper.appendChild(node);

              return {
                content: fragmentWrapper,
                tool: Tools.defaultTool,
                isBlock: false,
              };
            }

            case Node.ELEMENT_NODE: {
              const elementContent = node as HTMLElement;
              const tagSubstitute = this.toolRegistry.findToolForTag(elementContent.tagName) ?? undefined;

              return {
                content: elementContent,
                tool: tagSubstitute?.tool ?? Tools.defaultTool,
                isBlock: true,
              };
            }

            default:
              return null;
          }
        })();

        if (!nodeData) {
          return null;
        }

        const { content, tool, isBlock } = nodeData;

        const toolTags = this.buildToolTags(tool);

        const structuralSanitizeConfig = this.sanitizerBuilder.getStructuralTagsConfig(content);
        const customConfig = Object.assign({}, structuralSanitizeConfig, toolTags, tool.baseSanitizeConfig, { br: {} });
        const sanitizedContent = this.sanitizeContent(content, customConfig);

        if (!sanitizedContent) {
          return null;
        }

        const event = this.composePasteEvent('tag', {
          data: sanitizedContent,
        });

        return {
          content: sanitizedContent,
          isBlock,
          tool: tool.name,
          event,
        };
      })
      .filter((data): data is PasteData => {
        if (!data) {
          return false;
        }
        const isContentEmpty = dom$.isEmpty(data.content);
        const isSingleTag = dom$.isSingleTag(data.content);

        return !isContentEmpty || isSingleTag;
      });
  }

  /**
   * Build sanitizer config for a tool's tags.
   */
  private buildToolTags(tool: BlockToolAdapter): SanitizerConfig {
    if (tool.pasteConfig === false) {
      return {};
    }

    const tagsOrSanitizeConfigs = tool.pasteConfig?.tags || [];

    return tagsOrSanitizeConfigs.reduce<SanitizerConfig>((result: SanitizerConfig, tagOrSanitizeConfig: string | SanitizerConfig) => {
      const tags = collectTagNames(tagOrSanitizeConfig);
      const nextResult: SanitizerConfig = { ...result };

      tags.forEach((tag) => {
        const sanitizationConfig = isObject(tagOrSanitizeConfig)
          ? (tagOrSanitizeConfig)[tag]
          : null;

        nextResult[tag.toLowerCase()] = sanitizationConfig ?? {};
      });

      return nextResult;
    }, {} as SanitizerConfig);
  }

  /**
   * Sanitize content with special handling for tables.
   */
  private sanitizeContent(element: HTMLElement, config: SanitizerConfig): HTMLElement | null {
    if (element.tagName.toLowerCase() !== 'table') {
      const result = element.cloneNode(true) as HTMLElement;
      result.innerHTML = clean(element.innerHTML, config);

      return result;
    }

    return this.sanitizerBuilder.sanitizeTable(element, config);
  }

  /**
   * Fetch nodes from Element node.
   */
  private processElementNode(node: Node, nodes: Node[], destNode: Node): Node[] | void {
    const tags = Object.keys(this.toolRegistry.toolsTags);

    const element = node as HTMLElement;

    const tagSubstitute = this.toolRegistry.findToolForTag(element.tagName);
    const tool = tagSubstitute?.tool;
    const toolTags = tool ? this.toolRegistry.getToolTags(tool.name) : [];

    const isSubstitutable = tags.includes(element.tagName);
    const isBlockElement = dom$.blockElements.includes(element.tagName.toLowerCase());
    const isStructuralElement = SAFE_STRUCTURAL_TAGS.has(element.tagName.toLowerCase());
    const containsAnotherToolTags = Array
      .from(element.children)
      .some(
        ({ tagName }) => tags.includes(tagName) && !toolTags.includes(tagName)
      );

    const containsBlockElements = Array.from(element.children).some(
      ({ tagName }) => dom$.blockElements.includes(tagName.toLowerCase())
    );

    if (!isBlockElement && !isSubstitutable && !containsAnotherToolTags) {
      destNode.appendChild(element);

      return [...nodes, destNode];
    }

    if (
      (isSubstitutable && !containsAnotherToolTags) ||
      (isBlockElement && !containsBlockElements && !containsAnotherToolTags) ||
      (isStructuralElement && !containsAnotherToolTags)
    ) {
      return [...nodes, destNode, element];
    }
  }

  /**
   * Recursively divide HTML string to two types of nodes.
   */
  private getNodes(wrapper: Node): Node[] {
    const children = Array.from(wrapper.childNodes);

    const reducer = (nodes: Node[], node: Node): Node[] => {
      if (dom$.isEmpty(node) && !dom$.isSingleTag(node as HTMLElement)) {
        return nodes;
      }

      const lastNode = nodes[nodes.length - 1];
      const isLastNodeFragment = lastNode !== undefined && dom$.isFragment(lastNode);
      const { destNode, remainingNodes } = isLastNodeFragment
        ? {
          destNode: lastNode,
          remainingNodes: nodes.slice(0, -1),
        }
        : {
          destNode: new DocumentFragment(),
          remainingNodes: nodes,
        };

      if (node.nodeType === Node.TEXT_NODE) {
        destNode.appendChild(node);

        return [...remainingNodes, destNode];
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return [...remainingNodes, destNode];
      }

      const elementNodeProcessingResult = this.processElementNode(node, remainingNodes, destNode);

      if (elementNodeProcessingResult) {
        return elementNodeProcessingResult;
      }

      const processedChildNodes = Array.from(node.childNodes).reduce(reducer, []);

      return [...remainingNodes, ...processedChildNodes];
    };

    return children.reduce(reducer, []);
  }
}
