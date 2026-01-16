import { isObject, isValidMimeType, log } from '../../utils';
import type { BlokConfig } from '../../../../types/configs/blok-config';
import type { BlockToolAdapter } from '../../tools/block';
import type { ToolsCollection } from '../../tools/collection';
import type { TagSubstitute, FilesSubstitution, PatternSubstitute } from './types';
import { collectTagNames } from './constants';

/**
 * Tool Registry manages tool paste configurations.
 * Handles tag substitutions, file type mappings, and pattern matching.
 */
export class ToolRegistry {
  public readonly toolsTags: { [tag: string]: TagSubstitute } = {};
  public readonly tagsByTool: { [tool: string]: string[] } = {};
  public readonly toolsPatterns: PatternSubstitute[] = [];
  public readonly toolsFiles: { [tool: string]: FilesSubstitution } = {};
  public readonly exceptionList: string[] = [];

  constructor(
    private readonly tools: ToolsCollection<BlockToolAdapter>,
    private readonly config: BlokConfig
  ) {}

  /**
   * Process all tools and build registries.
   */
  public async processTools(): Promise<void> {
    const tools = this.tools;

    await Array
      .from(tools.values())
      .forEach(this.processTool);
  }

  /**
   * Process paste config for each tool.
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
      log(
        `Paste handling for «${tool.name}» Tool hasn't been set up because of the error`,
        'warn',
        e
      );
    }
  };

  /**
   * Get tags to substitute by Tool.
   */
  private getTagsConfig(tool: BlockToolAdapter): void {
    if (tool.pasteConfig === false) {
      return;
    }

    const tagsOrSanitizeConfigs = tool.pasteConfig.tags || [];
    const toolTags: string[] = [];

    tagsOrSanitizeConfigs.forEach((tagOrSanitizeConfig) => {
      const tags = collectTagNames(tagOrSanitizeConfig);

      toolTags.push(...tags);
      tags.forEach((tag: string) => {
        if (Object.prototype.hasOwnProperty.call(this.toolsTags, tag)) {
          log(
            `Paste handler for «${tool.name}» Tool on «${tag}» tag is skipped ` +
            `because it is already used by «${this.toolsTags[tag].tool.name}» Tool.`,
            'warn'
          );

          return;
        }
        const sanitizationConfig = isObject(tagOrSanitizeConfig) ? tagOrSanitizeConfig[tag] : undefined;

        this.toolsTags[tag.toUpperCase()] = {
          tool,
          sanitizationConfig,
        };
      });
    });

    this.tagsByTool[tool.name] = toolTags.map((t) => t.toUpperCase());
  }

  /**
   * Get files' types and extensions to substitute by Tool.
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

      log(`«extensions» property of the paste config for «${tool.name}» Tool should be an array`);

      return [];
    })();

    const normalizedMimeTypes = (() => {
      if (rawMimeTypes == null) {
        return [];
      }

      if (!Array.isArray(rawMimeTypes)) {
        log(`«mimeTypes» property of the paste config for «${tool.name}» Tool should be an array`);

        return [];
      }

      return rawMimeTypes.filter((type) => {
        if (!isValidMimeType(type)) {
          log(`MIME type value «${type}» for the «${tool.name}» Tool is not a valid MIME type`, 'warn');

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
   * Get RegExp patterns to substitute by Tool.
   */
  private getPatternsConfig(tool: BlockToolAdapter): void {
    if (
      tool.pasteConfig === false ||
      !tool.pasteConfig.patterns
    ) {
      return;
    }

    const patterns = tool.pasteConfig.patterns;

    if (Object.keys(patterns).length === 0) {
      return;
    }

    Object.entries(patterns).forEach(([key, pattern]: [string, RegExp]) => {
      if (!(pattern instanceof RegExp)) {
        log(
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
   * Find tool for a given tag.
   */
  public findToolForTag(tag: string): TagSubstitute | undefined {
    return this.toolsTags[tag];
  }

  /**
   * Find tool for a given file.
   */
  public findToolForFile(file: File): string | undefined {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

    const foundConfig = Object
      .entries(this.toolsFiles)
      .find(([, { mimeTypes, extensions }]) => {
        const [fileType, fileSubtype] = file.type.split('/');

        const foundExt = extensions.find((ext) => ext.toLowerCase() === extension);
        const foundMimeType = mimeTypes.find((mime) => {
          const [type, subtype] = mime.split('/');

          return type === fileType && (subtype === fileSubtype || subtype === '*');
        });

        return foundExt !== undefined || foundMimeType !== undefined;
      });

    return foundConfig?.[0];
  }

  /**
   * Find tool for a given pattern match.
   */
  public findToolForPattern(text: string): PatternSubstitute | undefined {
    return this.toolsPatterns.find((substitute) => {
      const execResult = substitute.pattern.exec(text);

      if (!execResult) {
        return false;
      }

      return text === execResult.shift();
    });
  }

  /**
   * Get tags for a specific tool.
   */
  public getToolTags(toolName: string): string[] {
    return this.tagsByTool[toolName] ?? [];
  }

  /**
   * Check if tool is in exception list.
   */
  public isException(toolName: string): boolean {
    return this.exceptionList.includes(toolName);
  }
}
