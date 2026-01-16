import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { HandlerContext, ProcessedFile } from '../types';
import type { ToolRegistry } from '../tool-registry';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';

/**
 * Type guard to check if data is a DataTransfer-like object.
 * In test environments, the global DataTransfer may not be available,
 * so we use duck typing to check the shape.
 */
const isDataTransfer = (data: unknown): data is DataTransfer => (
  typeof data === 'object' &&
  data !== null &&
  'files' in data &&
  'types' in data &&
  'getData' in data &&
  'setData' in data
);

/**
 * Files Handler Priority.
 * Detects if DataTransfer contains files.
 */
export class FilesHandler extends BasePasteHandler implements PasteHandler {
  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }
  canHandle(data: unknown): number {
    if (!isDataTransfer(data)) {
      return 0;
    }

    return this.containsFiles(data) ? 80 : 0;
  }

  async handle(data: unknown, _context: HandlerContext): Promise<boolean> {
    if (!isDataTransfer(data)) {
      return false;
    }

    if (!this.containsFiles(data)) {
      return false;
    }

    const files = data.files;

    if (!files || files.length === 0) {
      return false;
    }

    await this.processFiles(files);

    return true;
  }

  /**
   * Check if DataTransfer contains file-like entries.
   */
  private containsFiles(dataTransfer: DataTransfer): boolean {
    const types = Array.from(dataTransfer.types);

    if (types.includes('Files')) {
      return true;
    }

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
   * Get files from data transfer object and insert related Tools.
   */
  private async processFiles(items: FileList): Promise<void> {
    const { BlockManager } = this.Blok;

    const fileProcessingResults = await Promise.all(
      Array.from(items).map((item) => this.processFile(item))
    );
    const validFiles = fileProcessingResults.filter((result): result is ProcessedFile => result != null);

    if (validFiles.length === 0) {
      return;
    }

    const shouldReplaceCurrentBlock = this.shouldReplaceCurrentBlock(validFiles[0]?.type);

    for (const [index, fileData] of validFiles.entries()) {
      await BlockManager.paste(fileData.type, fileData.event, index === 0 && shouldReplaceCurrentBlock);
    }
  }

  /**
   * Get information about file and find Tool to handle it.
   */
  private async processFile(file: File): Promise<ProcessedFile | undefined> {
    const toolName = this.toolRegistry.findToolForFile(file);

    if (!toolName) {
      return;
    }

    const pasteEvent = this.composePasteEvent('file', {
      file,
    });

    return {
      event: pasteEvent,
      type: toolName,
    };
  }
}
