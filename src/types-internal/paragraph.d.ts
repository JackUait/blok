declare module '@editorjs/paragraph' {
  import { API, ConversionConfig, HTMLPasteEvent, PasteConfig, SanitizerConfig, ToolConfig, ToolboxConfig } from '@editorjs/editorjs';

  /**
   * @typedef {object} ParagraphConfig
   * @property {string} placeholder - placeholder for the empty paragraph
   * @property {boolean} preserveBlank - Whether or not to keep blank paragraphs when saving blok data
   */
  export interface ParagraphConfig extends ToolConfig {
    /**
     * Placeholder for the empty paragraph
     */
    placeholder?: string;
    /**
     * Whether or not to keep blank paragraphs when saving blok data
     */
    preserveBlank?: boolean;
  }

  /**
   * @typedef {object} ParagraphData
   * @description Tool's input and output data format
   * @property {string} text — Paragraph's content. Can include HTML tags: <a><b><i>
   */
  export interface ParagraphData {
    /**
     * Paragraph's content
     */
    text: string;
  }

  /**
   * @typedef {object} ParagraphParams
   * @description Constructor params for the Paragraph tool, use to pass initial data and settings
   * @property {ParagraphData} data - Preload data for the paragraph.
   * @property {ParagraphConfig} config - The configuration for the paragraph.
   * @property {API} api - The Blok API.
   * @property {boolean} readOnly - Is paragraph is read-only.
   */
  interface ParagraphParams {
    /**
     * Initial data for the paragraph
     */
    data: ParagraphData;
    /**
     * Paragraph tool configuration
     */
    config: ParagraphConfig;
    /**
     * Blok API
     */
    api: API;
    /**
     * Is paragraph read-only.
     */
    readOnly: boolean;
  }

  export default class Paragraph {
    /**
     * Default placeholder for Paragraph Tool
     *
     * @returns {string}
     * @class
     */
    static get DEFAULT_PLACEHOLDER(): string;
    /**
     * The Blok API
     */
    api: API;
    /**
     * Is Paragraph Tool read-only
     */
    readOnly: boolean;

    /**
     * Render plugin`s main Element and fill it with saved data
     *
     * @param {object} params - constructor params
     * @param {ParagraphData} params.data - previously saved data
     * @param {ParagraphConfig} params.config - user config for Tool
     * @param {object} params.api - Blok api
     * @param {boolean} readOnly - read only mode flag
     */
    constructor({ data, config, api, readOnly }: ParagraphParams);

    /**
     * Check if text content is empty and set empty string to inner html.
     * We need this because some browsers (e.g. Safari) insert <br> into empty contenteditanle elements
     *
     * @param {KeyboardEvent} e - key up event
     */
    onKeyUp(e: KeyboardEvent): void;

    /**
     * Return Tool's view
     *
     * @returns {HTMLDivElement}
     */
    render(): HTMLDivElement;

    /**
     * Method that specified how to merge two Text blocks.
     * Called by Blok by backspace at the beginning of the Block
     *
     * @param {ParagraphData} data
     * @public
     */
    merge(data: ParagraphData): void;

    /**
     * Validate Paragraph block data:
     * - check for emptiness
     *
     * @param {ParagraphData} savedData — data received after saving
     * @returns {boolean} false if saved data is not correct, otherwise true
     * @public
     */
    validate(savedData: ParagraphData): boolean;

    /**
     * Extract Tool's data from the view
     *
     * @param {HTMLDivElement} toolsContent - Paragraph tools rendered view
     * @returns {ParagraphData} - saved data
     * @public
     */
    save(toolsContent: HTMLDivElement): ParagraphData;

    /**
     * On paste callback fired from Blok.
     *
     * @param {HTMLPasteEvent} event - event with pasted data
     */
    onPaste(event: HTMLPasteEvent): void;

    /**
     * Enable Conversion Toolbar. Paragraph can be converted to/from other tools
     * @returns {ConversionConfig}
     */
    static get conversionConfig(): ConversionConfig;

    /**
     * Sanitizer rules
     * @returns {SanitizerConfig} - Edtior.js sanitizer config
     */
    static get sanitize(): SanitizerConfig;

    /**
     * Returns true to notify the core that read-only mode is supported
     *
     * @returns {boolean}
     */
    static get isReadOnlySupported(): boolean;

    /**
     * Used by Blok paste handling API.
     * Provides configuration to handle P tags.
     *
     * @returns {PasteConfig} - Paragraph Paste Setting
     */
    static get pasteConfig(): PasteConfig;

    /**
     * Icon and title for displaying at the Toolbox
     *
     * @returns {ToolboxConfig} - Paragraph Toolbox Setting
     */
    static get toolbox(): ToolboxConfig;
  }
}
