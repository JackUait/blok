import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, ProcessedFile } from '../types';

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

    const files = this.extractFiles(data);

    if (files.length === 0) {
      return false;
    }

    await this.processFiles(files);

    return true;
  }

  /**
   * Extract File objects from DataTransfer. Some platforms leave
   * `dataTransfer.files` empty but expose files through `dataTransfer.items`
   * where each entry has kind === 'file'. Fall back to items when needed.
   */
  private extractFiles(dataTransfer: DataTransfer): File[] {
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      return Array.from(dataTransfer.files);
    }

    return this.extractFilesFromItems(dataTransfer.items);
  }

  private extractFilesFromItems(items: DataTransferItemList | null | undefined): File[] {
    if (!items) {
      return [];
    }

    return Array.from(items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
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

    if (this.itemsContainFile(dataTransfer.items)) {
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

  private itemsContainFile(items: DataTransferItemList | null | undefined): boolean {
    if (!items) {
      return false;
    }

    return Array.from(items).some((item) => item.kind === 'file');
  }

  /**
   * Get files from data transfer object and insert related Tools.
   */
  private async processFiles(items: FileList | File[]): Promise<void> {
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
    const preferredToolName = this.Blok.BlockManager.currentBlock?.name;
    const toolName = this.toolRegistry.findToolForFile(file, preferredToolName);

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
