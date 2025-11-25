import Module from '../__module';
import $ from '../dom';
import * as _ from '../utils';
import type {
  PasteEvent,
  PasteEventDetail,
  SanitizerConfig,
  SanitizerRule
} from '../../../types';
import type { SavedData } from '../../../types/data-formats';
import { clean, composeSanitizerConfig, sanitizeBlocks } from '../utils/sanitizer';
import type BlockToolAdapter from '../tools/block';

/**
 * Tag substitute object.
 */
interface TagSubstitute {
  /**
   * Name of related Tool
   *
   */
  tool: BlockToolAdapter;

  /**
   * If a Tool specifies just a tag name, all the attributes will be sanitized.
   * But Tool can explicitly specify sanitizer configuration for supported tags
   */
  sanitizationConfig?: SanitizerRule;
}

const SAFE_STRUCTURAL_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
]);

/**
 * Pattern substitute object.
 */
interface PatternSubstitute {
  /**
   * Pattern`s key
   */
  key: string;

  /**
   * Pattern regexp
   */
  pattern: RegExp;

  /**
   * Name of related Tool
   */
  tool: BlockToolAdapter;
}

/**
 * Files` types substitutions object.
 */
interface FilesSubstitution {
  /**
   * Array of file extensions Tool can handle
   * @type {string[]}
   */
  extensions: string[];

  /**
   * Array of MIME types Tool can handle
   * @type {string[]}
   */
  mimeTypes: string[];
}

/**
 * Processed paste data object.
 * @interface PasteData
 */
interface PasteData {
  /**
   * Name of related Tool
   * @type {string}
   */
  tool: string;

  /**
   * Pasted data. Processed and wrapped to HTML element
   * @type {HTMLElement}
   */
  content: HTMLElement;

  /**
   * Pasted data
   */
  event: PasteEvent;

  /**
   * True if content should be inserted as new Block
   * @type {boolean}
   */
  isBlock: boolean;
}

/**
 * @class Paste
 * @classdesc Contains methods to handle paste on editor
 * @module Paste
 * @version 2.0.0
 */
export default class Paste extends Module {
  /** If string`s length is greater than this number we don't check paste patterns */
  public static readonly PATTERN_PROCESSING_MAX_LENGTH = 450;

  /** Custom EditorJS mime-type to handle in-editor copy/paste actions */
  public readonly MIME_TYPE = 'application/x-editor-js';

  /**
   * Tags` substitutions parameters
   */
  private toolsTags: { [tag: string]: TagSubstitute } = {};

  /**
   * Store tags to substitute by tool name
   */
  private tagsByTool: { [tools: string]: string[] } = {};

  /** Patterns` substitutions parameters */
  private toolsPatterns: PatternSubstitute[] = [];

  /** Files` substitutions parameters */
  private toolsFiles: {
    [tool: string]: FilesSubstitution;
  } = {};

  /**
   * List of tools which do not need a paste handling
   */
  private exceptionList: string[] = [];

  /**
   * Set onPaste callback and collect tools` paste configurations
   */
  public async prepare(): Promise<void> {
    this.processTools();
  }

  /**
   * Determines whether current block should be replaced by the pasted file tool.
   * @param toolName - tool that is going to handle the file
   */
  private shouldReplaceCurrentBlockForFile(toolName?: string): boolean {
    const { BlockManager } = this.Editor;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    if (toolName && currentBlock.name === toolName) {
      return true;
    }

    const isCurrentBlockDefault = Boolean(currentBlock.tool.isDefault);

    return isCurrentBlockDefault && currentBlock.isEmpty;
  }

  /**
   * Builds sanitize config that keeps structural tags such as tables and lists intact.
   * @param node - root node to inspect
   */
  private getStructuralTagsSanitizeConfig(node: HTMLElement): SanitizerConfig {
    const config: SanitizerConfig = {} as SanitizerConfig;
    const nodesToProcess: Element[] = [ node ];

    while (nodesToProcess.length > 0) {
      const current = nodesToProcess.pop();

      if (!current) {
        continue;
      }

      const tagName = current.tagName.toLowerCase();

      if (SAFE_STRUCTURAL_TAGS.has(tagName)) {
        config[tagName] = config[tagName] ?? {};
      }

      nodesToProcess.push(...Array.from(current.children));
    }

    return config;
  }

  /**
   * Set read-only state
   * @param {boolean} readOnlyEnabled - read only flag value
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      this.setCallback();
    } else {
      this.unsetCallback();
    }
  }

  /**
   * Determines whether provided DataTransfer contains file-like entries
   * @param dataTransfer - data transfer payload to inspect
   */
  private containsFiles(dataTransfer: DataTransfer): boolean {
    const types = Array.from(dataTransfer.types);

    /**
     * Common case: browser exposes explicit "Files" entry
     */
    if (types.includes('Files')) {
      return true;
    }

    /**
     * File uploads sometimes omit `types` and set files directly
     */
    if (dataTransfer.files?.length) {
      return true;
    }

    try {
      const legacyList = dataTransfer.types as unknown as DOMStringList;

      if (typeof legacyList?.contains === 'function' && legacyList.contains('Files')) {
        return true;
      }
    } catch {
      // ignore and fallthrough
    }

    return false;
  }

  /**
   * Handle pasted data transfer object
   * @param {DataTransfer} dataTransfer - pasted data transfer object
   */
  public async processDataTransfer(dataTransfer: DataTransfer): Promise<void> {
    const { Tools } = this.Editor;
    const includesFiles = this.containsFiles(dataTransfer);

    if (includesFiles && !_.isEmpty(this.toolsFiles)) {
      await this.processFiles(dataTransfer.files);

      return;
    }

    const editorJSData = dataTransfer.getData(this.MIME_TYPE);
    const plainData = dataTransfer.getData('text/plain');
    const rawHtmlData = dataTransfer.getData('text/html');
    const normalizedHtmlData = rawHtmlData;

    /**
     * If EditorJS json is passed, insert it
     */
    if (editorJSData) {
      try {
        this.insertEditorJSData(JSON.parse(editorJSData));

        return;
      } catch (e) { } // Do nothing and continue execution as usual if error appears
    }

    /** Add all tags that can be substituted to sanitizer configuration */
    const toolsTags = Object.fromEntries(
      Object.keys(this.toolsTags).map((tag) => [
        tag.toLowerCase(),
        this.toolsTags[tag].sanitizationConfig ?? {},
      ])
    ) as SanitizerConfig;

    const inlineSanitizeConfig = Tools.getAllInlineToolsSanitizeConfig();
    const customConfig = composeSanitizerConfig(
      this.config.sanitizer as SanitizerConfig,
      toolsTags,
      inlineSanitizeConfig,
      { br: {} }
    );
    const cleanData = clean(normalizedHtmlData, customConfig);
    const cleanDataIsHtml = $.isHTMLString(cleanData);
    const shouldProcessAsPlain = !cleanData.trim() || (cleanData.trim() === plainData || !cleanDataIsHtml);

    /** If there is no HTML or HTML string is equal to plain one, process it as plain text */
    if (shouldProcessAsPlain) {
      await this.processText(plainData);
    } else {
      await this.processText(cleanData, true);
    }
  }

  /**
   * Process pasted text and divide them into Blocks
   * @param {string} data - text to process. Can be HTML or plain.
   * @param {boolean} isHTML - if passed string is HTML, this parameter should be true
   */
  public async processText(data: string, isHTML = false): Promise<void> {
    const { Caret, BlockManager } = this.Editor;
    const dataToInsert = isHTML ? this.processHTML(data) : this.processPlain(data);

    if (!dataToInsert.length) {
      return;
    }

    if (dataToInsert.length > 1) {
      const isCurrentBlockDefault = Boolean(BlockManager.currentBlock?.tool.isDefault);
      const needToReplaceCurrentBlock = isCurrentBlockDefault && Boolean(BlockManager.currentBlock?.isEmpty);

      for (const [index, content] of dataToInsert.entries()) {
        await this.insertBlock(content, index === 0 && needToReplaceCurrentBlock);
      }

      BlockManager.currentBlock &&
        Caret.setToBlock(BlockManager.currentBlock, Caret.positions.END);

      return;
    }

    const [ singleItem ] = dataToInsert;

    if (singleItem.isBlock) {
      await this.processSingleBlock(singleItem);

      return;
    }

    await this.processInlinePaste(singleItem);
  }

  /**
   * Wrapper handler for paste event that matches listeners.on signature
   * @param {Event} event - paste event
   */
  private handlePasteEventWrapper = (event: Event): void => {
    void this.handlePasteEvent(event as ClipboardEvent);
  };

  /**
   * Set onPaste callback handler
   */
  private setCallback(): void {
    this.listeners.on(this.Editor.UI.nodes.holder, 'paste', this.handlePasteEventWrapper);
  }

  /**
   * Unset onPaste callback handler
   */
  private unsetCallback(): void {
    this.listeners.off(this.Editor.UI.nodes.holder, 'paste', this.handlePasteEventWrapper);
  }

  /**
   * Get and process tool`s paste configs
   */
  private processTools(): void {
    const tools = this.Editor.Tools.blockTools;

    Array
      .from(tools.values())
      .forEach(this.processTool);
  }

  /**
   * Process paste config for each tool
   * @param tool - BlockTool object
   */
  private processTool = (tool: BlockToolAdapter): void => {
    try {
      if (tool.pasteConfig === false) {
        this.exceptionList.push(tool.name);

        return;
      }

      if (!tool.hasOnPasteHandler) {
        return;
      }

      this.getTagsConfig(tool);
      this.getFilesConfig(tool);
      this.getPatternsConfig(tool);
    } catch (e) {
      _.log(
        `Paste handling for «${tool.name}» Tool hasn't been set up because of the error`,
        'warn',
        e
      );
    }
  };

  /**
   * Get tags name list from either tag name or sanitization config.
   * @param {string | object} tagOrSanitizeConfig - tag name or sanitize config object.
   * @returns {string[]} array of tags.
   */
  private collectTagNames(tagOrSanitizeConfig: string | SanitizerConfig): string[] {
    /**
     * If string, then it is a tag name.
     */
    if (_.isString(tagOrSanitizeConfig)) {
      return [ tagOrSanitizeConfig ];
    }
    /**
     * If object, then its keys are tags.
     */
    if (_.isObject(tagOrSanitizeConfig)) {
      return Object.keys(tagOrSanitizeConfig);
    }

    /** Return empty tag list */
    return [];
  }

  /**
   * Get tags to substitute by Tool
   * @param tool - BlockTool object
   */
  private getTagsConfig(tool: BlockToolAdapter): void {
    if (tool.pasteConfig === false) {
      return;
    }

    const tagsOrSanitizeConfigs = tool.pasteConfig.tags || [];
    const toolTags: string[] = [];

    tagsOrSanitizeConfigs.forEach((tagOrSanitizeConfig) => {
      const tags = this.collectTagNames(tagOrSanitizeConfig);

      /**
       * Add tags to toolTags array
       */
      toolTags.push(...tags);
      tags.forEach((tag) => {
        if (Object.prototype.hasOwnProperty.call(this.toolsTags, tag)) {
          _.log(
            `Paste handler for «${tool.name}» Tool on «${tag}» tag is skipped ` +
            `because it is already used by «${this.toolsTags[tag].tool.name}» Tool.`,
            'warn'
          );

          return;
        }
        /**
         * Get sanitize config for tag.
         */
        const sanitizationConfig = _.isObject(tagOrSanitizeConfig) ? tagOrSanitizeConfig[tag] : undefined;

        this.toolsTags[tag.toUpperCase()] = {
          tool,
          sanitizationConfig,
        };
      });
    });

    this.tagsByTool[tool.name] = toolTags.map((t) => t.toUpperCase());
  }

  /**
   * Get files` types and extensions to substitute by Tool
   * @param tool - BlockTool object
   */
  private getFilesConfig(tool: BlockToolAdapter): void {
    if (tool.pasteConfig === false) {
      return;
    }

    const { files = {} } = tool.pasteConfig;
    const { extensions: rawExtensions, mimeTypes: rawMimeTypes } = files;

    if (!rawExtensions && !rawMimeTypes) {
      return;
    }

    const normalizedExtensions = (() => {
      if (rawExtensions == null) {
        return [];
      }

      if (Array.isArray(rawExtensions)) {
        return rawExtensions;
      }

      _.log(`«extensions» property of the paste config for «${tool.name}» Tool should be an array`);

      return [];
    })();

    const normalizedMimeTypes = (() => {
      if (rawMimeTypes == null) {
        return [];
      }

      if (!Array.isArray(rawMimeTypes)) {
        _.log(`«mimeTypes» property of the paste config for «${tool.name}» Tool should be an array`);

        return [];
      }

      return rawMimeTypes.filter((type) => {
        if (!_.isValidMimeType(type)) {
          _.log(`MIME type value «${type}» for the «${tool.name}» Tool is not a valid MIME type`, 'warn');

          return false;
        }

        return true;
      });
    })();

    this.toolsFiles[tool.name] = {
      extensions: normalizedExtensions,
      mimeTypes: normalizedMimeTypes,
    };
  }

  /**
   * Get RegExp patterns to substitute by Tool
   * @param tool - BlockTool object
   */
  private getPatternsConfig(tool: BlockToolAdapter): void {
    if (
      tool.pasteConfig === false ||
      !tool.pasteConfig.patterns ||
      _.isEmpty(tool.pasteConfig.patterns)
    ) {
      return;
    }

    Object.entries(tool.pasteConfig.patterns).forEach(([key, pattern]: [string, RegExp]) => {
      /** Still need to validate pattern as it provided by user */
      if (!(pattern instanceof RegExp)) {
        _.log(
          `Pattern ${pattern} for «${tool.name}» Tool is skipped because it should be a Regexp instance.`,
          'warn'
        );
      }

      this.toolsPatterns.push({
        key,
        pattern,
        tool,
      });
    });
  }

  /**
   * Check if browser behavior suits better
   * @param {EventTarget} element - element where content has been pasted
   * @returns {boolean}
   */
  private isNativeBehaviour(element: EventTarget): boolean {
    return $.isNativeInput(element);
  }

  /**
   * Check if Editor should process pasted data and pass data transfer object to handler
   * @param {ClipboardEvent} event - clipboard event
   */
  private handlePasteEvent = async (event: ClipboardEvent): Promise<void> => {
    const { BlockManager, Toolbar } = this.Editor;

    /**
     * When someone pasting into a block, its more stable to set current block by event target, instead of relying on current block set before
     */
    const currentBlock = BlockManager.setCurrentBlockByChildNode(event.target as HTMLElement);

    /** If target is native input or is not Block, use browser behaviour */
    if (
      !currentBlock || (event.target && this.isNativeBehaviour(event.target) && event.clipboardData && !event.clipboardData.types.includes('Files'))
    ) {
      return;
    }

    /**
     * If Tools is in list of errors, skip processing of paste event
     */
    if (this.exceptionList.includes(currentBlock.name)) {
      return;
    }

    event.preventDefault();
    if (event.clipboardData) {
      await this.processDataTransfer(event.clipboardData);
    }

    Toolbar.close();
  };

  /**
   * Get files from data transfer object and insert related Tools
   * @param {FileList} items - pasted items
   */
  private async processFiles(items: FileList): Promise<void> {
    const { BlockManager } = this.Editor;

    const processedFiles = await Promise.all(
      Array
        .from(items)
        .map((item) => this.processFile(item))
    );
    const dataToInsert = processedFiles.filter((data): data is { type: string; event: PasteEvent } => data != null);

    if (dataToInsert.length === 0) {
      return;
    }

    const shouldReplaceCurrentBlock = this.shouldReplaceCurrentBlockForFile(dataToInsert[0]?.type);

    for (const [index, data] of dataToInsert.entries()) {
      await BlockManager.paste(data.type, data.event, index === 0 && shouldReplaceCurrentBlock);
    }
  }

  /**
   * Get information about file and find Tool to handle it
   * @param {File} file - file to process
   */
  private async processFile(file: File): Promise<{ event: PasteEvent; type: string } | undefined> {
    const extension = _.getFileExtension(file);

    const foundConfig = Object
      .entries(this.toolsFiles)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
      .find(([toolName, { mimeTypes, extensions } ]) => {
        const [fileType, fileSubtype] = file.type.split('/');

        const foundExt = extensions.find((ext) => ext.toLowerCase() === extension.toLowerCase());
        const foundMimeType = mimeTypes.find((mime) => {
          const [type, subtype] = mime.split('/');

          return type === fileType && (subtype === fileSubtype || subtype === '*');
        });

        return foundExt !== undefined || foundMimeType !== undefined;
      });

    if (!foundConfig) {
      return;
    }

    const [ tool ] = foundConfig;
    const pasteEvent = this.composePasteEvent('file', {
      file,
    });

    return {
      event: pasteEvent,
      type: tool,
    };
  }

  /**
   * Split HTML string to blocks and return it as array of Block data
   * @param {string} innerHTML - html string to process
   * @returns {PasteData[]}
   */
  private processHTML(innerHTML: string): PasteData[] {
    const { Tools } = this.Editor;

    /**
     * @todo Research, do we really need to always wrap innerHTML to a div:
     *  - <img> tag could be processed separately, but for now it becomes div-wrapped
     *    and then .getNodes() returns strange: [document-fragment, img]
     *    (description of the method says that it should should return only block tags or fragments,
     *     but there are inline-block element along with redundant empty fragment)
     *  - probably this is a reason of bugs with unexpected new block creation instead of inline pasting:
     *      - https://github.com/codex-team/editor.js/issues/1427
     *      - https://github.com/codex-team/editor.js/issues/1244
     *      - https://github.com/codex-team/editor.js/issues/740
     */
    const wrapper = $.make('DIV');

    wrapper.innerHTML = innerHTML;

    const nodes = this.getNodes(wrapper);

    return nodes
      .map((node) => {
        const nodeData = (() => {
          switch (node.nodeType) {
            case Node.DOCUMENT_FRAGMENT_NODE: {
              const fragmentWrapper = $.make('div');

              fragmentWrapper.appendChild(node);

              return {
                content: fragmentWrapper,
                tool: Tools.defaultTool,
                isBlock: false,
              };
            }

            case Node.ELEMENT_NODE: {
              const elementContent = node as HTMLElement;
              const tagSubstitute = this.toolsTags[elementContent.tagName];

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

        const tagsOrSanitizeConfigs = tool.pasteConfig === false
          ? []
          : (tool.pasteConfig?.tags || []);

        const toolTags = tagsOrSanitizeConfigs.reduce<SanitizerConfig>((result, tagOrSanitizeConfig) => {
          const tags = this.collectTagNames(tagOrSanitizeConfig);
          const nextResult: SanitizerConfig = { ...result };

          tags.forEach((tag) => {
            const sanitizationConfig = _.isObject(tagOrSanitizeConfig)
              ? (tagOrSanitizeConfig as SanitizerConfig)[tag]
              : null;

            nextResult[tag.toLowerCase()] = sanitizationConfig ?? {};
          });

          return nextResult;
        }, {} as SanitizerConfig);

        const structuralSanitizeConfig = this.getStructuralTagsSanitizeConfig(content);
        const customConfig = Object.assign({}, structuralSanitizeConfig, toolTags, tool.baseSanitizeConfig);
        const sanitizedContent = (() => {
          if (content.tagName.toLowerCase() !== 'table') {
            content.innerHTML = clean(content.innerHTML, customConfig);

            return content;
          }

          const cleanTableHTML = clean(content.outerHTML, customConfig);
          const tmpWrapper = $.make('div', undefined, {
            innerHTML: cleanTableHTML,
          });
          const firstChild = tmpWrapper.firstChild;

          if (!firstChild || !(firstChild instanceof HTMLElement)) {
            return null;
          }

          return firstChild;
        })();

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
        const isEmpty = $.isEmpty(data.content);
        const isSingleTag = $.isSingleTag(data.content);

        return !isEmpty || isSingleTag;
      });
  }

  /**
   * Split plain text by new line symbols and return it as array of Block data
   * @param {string} plain - string to process
   * @returns {PasteData[]}
   */
  private processPlain(plain: string): PasteData[] {
    const { defaultBlock } = this.config as { defaultBlock: string };

    if (!plain) {
      return [];
    }

    const tool = defaultBlock;

    return plain
      .split(/\r?\n/)
      .filter((text) => text.trim())
      .map((text) => {
        const content = $.make('div');

        content.textContent = text;

        const event = this.composePasteEvent('tag', {
          data: content,
        });

        return {
          content,
          tool,
          isBlock: false,
          event,
        };
      });
  }

  /**
   * Process paste of single Block tool content
   * @param {PasteData} dataToInsert - data of Block to insert
   */
  private async processSingleBlock(dataToInsert: PasteData): Promise<void> {
    const { Caret, BlockManager } = this.Editor;
    const { currentBlock } = BlockManager;

    /**
     * If pasted tool isn`t equal current Block or if pasted content contains block elements, insert it as new Block
     */
    if (
      !currentBlock ||
      dataToInsert.tool !== currentBlock.name ||
      !$.containsOnlyInlineElements(dataToInsert.content.innerHTML)
    ) {
      await this.insertBlock(dataToInsert, currentBlock ? (currentBlock.tool.isDefault && currentBlock.isEmpty) : false);

      return;
    }

    Caret.insertContentAtCaretPosition(dataToInsert.content.innerHTML);
  }

  /**
   * Process paste to single Block:
   * 1. Find patterns` matches
   * 2. Insert new block if it is not the same type as current one
   * 3. Just insert text if there is no substitutions
   * @param {PasteData} dataToInsert - data of Block to insert
   */
  private async processInlinePaste(dataToInsert: PasteData): Promise<void> {
    const { BlockManager, Caret } = this.Editor;
    const { content } = dataToInsert;

    const currentBlockIsDefault = BlockManager.currentBlock?.tool.isDefault ?? false;
    const textContent = content.textContent;

    const canProcessPattern = currentBlockIsDefault &&
      textContent !== null &&
      textContent.length < Paste.PATTERN_PROCESSING_MAX_LENGTH;

    const blockData = canProcessPattern && textContent !== null
      ? await this.processPattern(textContent)
      : undefined;

    if (blockData) {
      const needToReplaceCurrentBlock = BlockManager.currentBlock &&
        BlockManager.currentBlock.tool.isDefault &&
        BlockManager.currentBlock.isEmpty;

      const insertedBlock = await BlockManager.paste(blockData.tool, blockData.event, needToReplaceCurrentBlock);

      Caret.setToBlock(insertedBlock, Caret.positions.END);

      return;
    }

    /** If there is no pattern substitute - insert string as it is */
    if (BlockManager.currentBlock && BlockManager.currentBlock.currentInput) {
      const currentToolSanitizeConfig = BlockManager.currentBlock.tool.baseSanitizeConfig;

      Caret.insertContentAtCaretPosition(
        clean(content.innerHTML, currentToolSanitizeConfig)
      );
    } else {
      await this.insertBlock(dataToInsert);
    }
  }

  /**
   * Get patterns` matches
   * @param {string} text - text to process
   * @returns {Promise<{event: PasteEvent, tool: string}>}
   */
  private async processPattern(text: string): Promise<{ event: PasteEvent; tool: string } | undefined> {
    const pattern = this.toolsPatterns.find((substitute) => {
      const execResult = substitute.pattern.exec(text);

      if (!execResult) {
        return false;
      }

      return text === execResult.shift();
    });

    if (!pattern) {
      return;
    }

    const event = this.composePasteEvent('pattern', {
      key: pattern.key,
      data: text,
    });

    return {
      event,
      tool: pattern.tool.name,
    };
  }

  /**
   * Insert pasted Block content to Editor
   * @param {PasteData} data - data to insert
   * @param {boolean} canReplaceCurrentBlock - if true and is current Block is empty, will replace current Block
   * @returns {void}
   */
  private async insertBlock(data: PasteData, canReplaceCurrentBlock = false): Promise<void> {
    const { BlockManager, Caret } = this.Editor;
    const { currentBlock } = BlockManager;

    if (canReplaceCurrentBlock && currentBlock && currentBlock.isEmpty) {
      const replacedBlock = await BlockManager.paste(data.tool, data.event, true);

      Caret.setToBlock(replacedBlock, Caret.positions.END);

      return;
    }

    const block = await BlockManager.paste(data.tool, data.event);

    Caret.setToBlock(block, Caret.positions.END);
  }

  /**
   * Insert data passed as application/x-editor-js JSON
   * @param {Array} blocks — Blocks' data to insert
   * @returns {void}
   */
  private insertEditorJSData(blocks: Pick<SavedData, 'id' | 'data' | 'tool'>[]): void {
    const { BlockManager, Caret, Tools } = this.Editor;
    const sanitizedBlocks = sanitizeBlocks(
      blocks,
      (name) => Tools.blockTools.get(name)?.sanitizeConfig ?? {},
      this.config.sanitizer as SanitizerConfig
    );

    sanitizedBlocks.forEach(({ tool, data }, i) => {
      const needToReplaceCurrentBlock = i === 0 &&
        Boolean(BlockManager.currentBlock?.tool.isDefault) &&
        Boolean(BlockManager.currentBlock?.isEmpty);

      const block = BlockManager.insert({
        tool,
        data,
        replace: needToReplaceCurrentBlock,
      });

      Caret.setToBlock(block, Caret.positions.END);
    });
  }

  /**
   * Fetch nodes from Element node
   * @param {Node} node - current node
   * @param {Node[]} nodes - processed nodes
   * @param {Node} destNode - destination node
   */
  private processElementNode(node: Node, nodes: Node[], destNode: Node): Node[] | void {
    const tags = Object.keys(this.toolsTags);

    const element = node as HTMLElement;

    const tagSubstitute = this.toolsTags[element.tagName];
    const tool = tagSubstitute?.tool;
    const toolTags = this.tagsByTool[tool?.name ?? ''] ?? [];

    const isSubstitutable = tags.includes(element.tagName);
    const isBlockElement = $.blockElements.includes(element.tagName.toLowerCase());
    const isStructuralElement = SAFE_STRUCTURAL_TAGS.has(element.tagName.toLowerCase());
    const containsAnotherToolTags = Array
      .from(element.children)
      .some(
        ({ tagName }) => tags.includes(tagName) && !toolTags.includes(tagName)
      );

    const containsBlockElements = Array.from(element.children).some(
      ({ tagName }) => $.blockElements.includes(tagName.toLowerCase())
    );

    /** Append inline elements to previous fragment */
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
   * Recursively divide HTML string to two types of nodes:
   * 1. Block element
   * 2. Document Fragments contained text and markup tags like a, b, i etc.
   * @param {Node} wrapper - wrapper of paster HTML content
   * @returns {Node[]}
   */
  private getNodes(wrapper: Node): Node[] {
    const children = Array.from(wrapper.childNodes);

    const reducer = (nodes: Node[], node: Node): Node[] => {
      if ($.isEmpty(node) && !$.isSingleTag(node as HTMLElement)) {
        return nodes;
      }

      const lastNode = nodes[nodes.length - 1];
      const isLastNodeFragment = lastNode !== undefined && $.isFragment(lastNode);
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

  /**
   * Compose paste event with passed type and detail
   * @param {string} type - event type
   * @param {PasteEventDetail} detail - event detail
   */
  private composePasteEvent(type: string, detail: PasteEventDetail): PasteEvent {
    return new CustomEvent(type, {
      detail,
    }) as PasteEvent;
  }
}
