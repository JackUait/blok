# Paste Module Refactor Design Document

**Date:** 2025-01-16
**Status:** Design Approved
**Author:** Claude Code

---

## Overview

The `src/components/modules/paste.ts` file is 1,133 lines and handles multiple responsibilities: tool configuration, clipboard event routing, file processing, HTML processing, pattern matching, and block insertion. This creates difficulties in:

- **Complexity:** Hard to understand and navigate due to intertwined logic
- **Testability:** Individual behaviors are difficult to test in isolation
- **Extensibility:** Adding new paste handlers requires touching this large file

This design document outlines a refactoring to split the `Paste` class into a coordinator that delegates to specialized handlers using a Chain of Responsibility pattern.

---

## Architecture

### High-Level Structure

```
src/components/modules/paste/
├── index.ts              # Paste coordinator (thin orchestration layer)
├── handlers/
│   ├── base.ts           # Abstract base class for all handlers
│   ├── files-handler.ts  # File paste processing
│   ├── html-handler.ts   # HTML paste processing
│   ├── text-handler.ts   # Plain text paste processing
│   ├── pattern-handler.ts # Pattern matching logic
│   └── blok-data-handler.ts # Internal Blok JSON paste
├── tool-registry.ts      # Tool configuration management
├── sanitizer-config.ts   # Sanitization configuration building
└── types.ts              # Shared types for paste subsystem
```

### Design Pattern: Chain of Responsibility

Handlers are tried in priority order until one accepts the data:

| Handler | Data Type | Priority |
|---------|-----------|----------|
| BlokDataHandler | `application/x-blok` JSON | 100 |
| FilesHandler | FileList | 80 |
| PatternHandler | Plain text matching patterns | 60 |
| HtmlHandler | HTML string | 40 |
| TextHandler | Plain text | 10 |

---

## Module Specifications

### 1. Types (`types.ts`)

Shared types across the paste subsystem.

```typescript
/**
 * Tag substitute object.
 */
export interface TagSubstitute {
  tool: BlockToolAdapter;
  sanitizationConfig?: SanitizerRule;
}

/**
 * Pattern substitute object.
 */
export interface PatternSubstitute {
  key: string;
  pattern: RegExp;
  tool: BlockToolAdapter;
}

/**
 * Files' types substitutions object.
 */
export interface FilesSubstitution {
  extensions: string[];
  mimeTypes: string[];
}

/**
 * Processed paste data object.
 */
export interface PasteData {
  tool: string;
  content: HTMLElement;
  event: PasteEvent;
  isBlock: boolean;
}

/**
 * Context passed to handlers.
 */
export interface HandlerContext {
  canReplaceCurrentBlock: boolean;
  currentBlock?: Block;
}

/**
 * Pattern match result.
 */
export interface PatternMatch {
  key: string;
  data: string;
  tool: string;
  event: PasteEvent;
}

/**
 * Processed file result.
 */
export interface ProcessedFile {
  event: PasteEvent;
  type: string;
}
```

---

### 2. Tool Registry (`tool-registry.ts`)

**Responsibilities:**
- Parse tool paste configs (tags, files, patterns)
- Store and retrieve tool substitutions
- Validate MIME types and patterns
- Handle tool configuration errors

**Interface:**

```typescript
export class ToolRegistry {
  public readonly toolsTags: { [tag: string]: TagSubstitute } = {};
  public readonly tagsByTool: { [tool: string]: string[] } = {};
  public readonly toolsPatterns: PatternSubstitute[] = [];
  public readonly toolsFiles: { [tool: string]: FilesSubstitution } = {};
  public readonly exceptionList: string[] = [];

  constructor(
    private tools: ToolsCollection,
    private config: BlokConfig
  ) {}

  /**
   * Process all tools and build registries.
   */
  public async processTools(): Promise<void>;

  /**
   * Find tool for a given tag.
   */
  public findToolForTag(tag: string): TagSubstitute | undefined;

  /**
   * Find tool for a given file.
   */
  public findToolForFile(file: File): string | undefined;

  /**
   * Find tool for a given pattern match.
   */
  public findToolForPattern(text: string): PatternSubstitute | undefined;

  /**
   * Get tags for a specific tool.
   */
  public getToolTags(toolName: string): string[];

  /**
   * Check if tool is in exception list.
   */
  public isException(toolName: string): boolean;
}
```

**Extracted from `paste.ts`:**
- Lines 132-145: Property declarations
- Lines 413-447: `processTools()` and `processTool()`
- Lines 454-514: Tag configuration (`collectTagNames`, `getTagsConfig`)
- Lines 520-572: File configuration (`getFilesConfig`)
- Lines 578-602: Pattern configuration (`getPatternsConfig`)

---

### 3. Sanitizer Config Builder (`sanitizer-config.ts`)

**Responsibilities:**
- Build sanitizer configs from tool configurations
- Detect structural tags (tables, lists) in pasted content
- Merge multiple sanitizer configs safely
- Handle table-specific sanitization

**Interface:**

```typescript
export class SanitizerConfigBuilder {
  private static readonly SAFE_STRUCTURAL_TAGS = new Set([
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'colgroup', 'col', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  ]);

  constructor(
    private tools: ToolsCollection,
    private config: BlokConfig
  ) {}

  /**
   * Build sanitizer config for all tool tags.
   */
  public buildToolsTagsConfig(toolsTags: { [tag: string]: TagSubstitute }): SanitizerConfig;

  /**
   * Detect structural tags in HTML node.
   */
  public getStructuralTagsConfig(node: HTMLElement): SanitizerConfig;

  /**
   * Build sanitizer config for a specific tool.
   */
  public buildToolConfig(tool: BlockToolAdapter): SanitizerConfig;

  /**
   * Compose multiple sanitizer configs.
   */
  public composeConfigs(...configs: SanitizerConfig[]): SanitizerConfig;

  /**
   * Special handling for table sanitization.
   */
  public sanitizeTable(table: HTMLElement, config: SanitizerConfig): HTMLElement | null;
}
```

**Extracted from `paste.ts`:**
- Lines 31-48: `SAFE_STRUCTURAL_TAGS` constant
- Lines 184-205: `getStructuralTagsSanitizeConfig()`
- Lines 280-293: Sanitization config building in `processDataTransfer()`
- Lines 773-812: Tool-specific config building and table sanitization in `processHTML()`

---

### 4. Base Handler (`handlers/base.ts`)

**Interface:**

```typescript
export interface PasteHandler {
  /**
   * Check if this handler can process the given data.
   * @returns Priority score (higher = more specific). Return 0 to skip.
   */
  canHandle(data: unknown): number;

  /**
   * Process the data and insert blocks.
   * @returns true if handled, false otherwise
   */
  handle(data: unknown, context: HandlerContext): Promise<boolean>;
}

export abstract class BasePasteHandler implements PasteHandler {
  constructor(
    protected Blok: BlokModules,
    protected toolRegistry: ToolRegistry,
    protected sanitizerBuilder: SanitizerConfigBuilder
  ) {}

  abstract canHandle(data: unknown): number;
  abstract handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Compose a paste event with the given type and detail.
   */
  protected composePasteEvent(type: string, detail: PasteEventDetail): PasteEvent;

  /**
   * Determine if current block should be replaced.
   */
  protected shouldReplaceCurrentBlock(toolName?: string): boolean;

  /**
   * Insert paste data as blocks.
   */
  protected async insertPasteData(
    data: PasteData[],
    canReplaceCurrentBlock: boolean
  ): Promise<void>;
}
```

---

### 5. Blok Data Handler (`handlers/blok-data-handler.ts`)

**Responsibilities:**
- Parse and validate Blok JSON data
- Sanitize blocks using tool configs
- Handle pattern matching priority for URLs
- Insert blocks at caret position

**Interface:**

```typescript
export class BlokDataHandler extends BasePasteHandler {
  canHandle(data: unknown): number;

  async handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Try pattern matching before inserting Blok JSON.
   */
  private tryPatternMatch(plainData: string): Promise<PatternMatch | undefined>;

  /**
   * Insert Blok JSON blocks.
   */
  private insertBlokBlocks(
    blocks: Pick<SavedData, 'id' | 'data' | 'tool'>[],
    canReplace: boolean
  ): void;
}
```

**Extracted from `paste.ts`:**
- Lines 315-333: `handleBlokDataPaste()`
- Lines 339-348: `insertPatternMatch()`
- Lines 1004-1025: `insertBlokData()`

---

### 6. Files Handler (`handlers/files-handler.ts`)

**Responsibilities:**
- Detect if DataTransfer contains files
- Match files to tools by extension and/or MIME type
- Process multiple files in sequence
- Handle file-matching errors gracefully

**Interface:**

```typescript
export class FilesHandler extends BasePasteHandler {
  canHandle(data: unknown): number;

  async handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Check if DataTransfer contains file-like entries.
   */
  private containsFiles(dataTransfer: DataTransfer): boolean;

  /**
   * Process a single file and find matching tool.
   */
  private async processFile(file: File): Promise<ProcessedFile | undefined>;

  /**
   * Insert file blocks.
   */
  private async insertFileBlocks(
    files: ProcessedFile[],
    canReplaceCurrentBlock: boolean
  ): Promise<void>;
}
```

**Extracted from `paste.ts`:**
- Lines 220-251: `containsFiles()`
- Lines 163-178: `shouldReplaceCurrentBlockForFile()`
- Lines 651-708: `processFiles()` and `processFile()`

---

### 7. Pattern Handler (`handlers/pattern-handler.ts`)

**Responsibilities:**
- Match text against tool patterns
- Compose paste events for matched patterns
- Insert new blocks for pattern matches
- Provide public interface for other handlers

**Interface:**

```typescript
export class PatternHandler extends BasePasteHandler {
  public static readonly PATTERN_PROCESSING_MAX_LENGTH = 450;

  canHandle(data: unknown): number;

  async handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Find pattern match in text.
   */
  private findPatternMatch(text: string): PatternMatch | undefined;

  /**
   * Insert pattern block (public for other handlers to call).
   */
  async insertPatternBlock(match: PatternMatch, canReplace: boolean): Promise<void>;
}
```

**Extracted from `paste.ts`:**
- Line 124: `PATTERN_PROCESSING_MAX_LENGTH` constant
- Lines 945-974: `processPattern()`
- Lines 339-348: `insertPatternMatch()`

---

### 8. HTML Handler (`handlers/html-handler.ts`)

**Responsibilities:**
- Parse HTML string into DOM nodes
- Categorize nodes as blocks or inline fragments
- Match block-level tags to tools
- Sanitize content per-tool configs
- Handle structural elements (tables, lists)

**Interface:**

```typescript
export class HtmlHandler extends BasePasteHandler {
  canHandle(data: unknown): number;

  async handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Process HTML string into PasteData array.
   */
  private processHTML(innerHTML: string): PasteData[];

  /**
   * Extract nodes from wrapper (blocks and fragments).
   */
  private extractNodes(wrapper: Node): Node[];

  /**
   * Process element node during extraction.
   */
  private processElementNode(node: Node, nodes: Node[], destNode: Node): Node[] | void;

  /**
   * Convert node to PasteData with sanitization.
   */
  private nodeToPasteData(node: Node): PasteData | null;

  /**
   * Build sanitizer config for HTML processing.
   */
  private buildSanitizeConfig(): SanitizerConfig;
}
```

**Extracted from `paste.ts`:**
- Lines 31-48: `SAFE_STRUCTURAL_TAGS` (moved to SanitizerConfigBuilder)
- Lines 715-838: `processHTML()`
- Lines 1033-1120: `getNodes()` and `processElementNode()`
- Lines 280-296: HTML sanitization in `processDataTransfer()`

---

### 9. Text Handler (`handlers/text-handler.ts`)

**Responsibilities:**
- Split text by newlines
- Create div elements with text content
- Delegate to default block tool
- Always succeeds (fallback handler)

**Interface:**

```typescript
export class TextHandler extends BasePasteHandler {
  canHandle(data: unknown): number;

  async handle(data: unknown, context: HandlerContext): Promise<boolean>;

  /**
   * Process plain text into PasteData array.
   */
  private processPlain(plain: string): PasteData[];
}
```

**Extracted from `paste.ts`:**
- Lines 845-873: `processPlain()`

---

### 10. Paste Coordinator (`index.ts`)

**Responsibilities:**
- Register/unregister paste event listener
- Route paste events to appropriate handlers
- Manage read-only state
- Delegate to ToolRegistry and handlers

**Interface:**

```typescript
export class Paste extends Module {
  public static readonly PATTERN_PROCESSING_MAX_LENGTH = 450;
  public readonly MIME_TYPE = 'application/x-blok';

  private toolRegistry: ToolRegistry;
  private sanitizerBuilder: SanitizerConfigBuilder;
  private handlers: PasteHandler[];

  public async prepare(): Promise<void>;

  public toggleReadOnly(readOnlyEnabled: boolean): void;

  /**
   * Route paste data to handlers in priority order.
   */
  private async routeToHandlers(
    dataTransfer: DataTransfer,
    canReplaceCurrentBlock: boolean
  ): Promise<boolean>;

  private setCallback(): void;
  private unsetCallback(): void;
  private handlePasteEvent(event: ClipboardEvent): Promise<void>;
}
```

**Remaining in `paste.ts`:**
- Lines 122-127: Constants and MIME type
- Lines 155-157: `prepare()` entry point
- Lines 207-217: `toggleReadOnly()`
- Lines 392-408: Callback management
- Lines 617-645: `handlePasteEvent()` (simplified to call `routeToHandlers`)

---

## Test Strategy

**Test file structure:**
```
test/unit/components/modules/paste/
├── tool-registry.test.ts
├── sanitizer-config-builder.test.ts
├── handlers/
│   ├── base-handler.test.ts
│   ├── blok-data-handler.test.ts
│   ├── files-handler.test.ts
│   ├── pattern-handler.test.ts
│   ├── html-handler.test.ts
│   └── text-handler.test.ts
└── paste-coordinator.test.ts
```

### Test Coverage Requirements

**1. ToolRegistry Tests**
- Registering tools with various paste configs
- Tag/tool lookups
- File type matching (extensions, MIME types, edge cases)
- Pattern matching and validation
- Exception list management
- Invalid config handling (logged warnings, doesn't crash)

**2. SanitizerConfigBuilder Tests**
- Building configs from tool tags
- Structural tag detection in HTML
- Config merging (inline + structural + tool + custom)
- Table sanitization special case
- Empty/invalid input handling

**3. Handler Tests** (each handler)
- `canHandle()` returns correct priority for supported/unsupported data
- `handle()` processes data correctly
- Returns `false` when unable to handle
- Blocks are inserted with correct parameters
- Caret is positioned correctly
- Error conditions don't crash

**4. HtmlHandler Tests** (most complex)
- Node extraction for various HTML structures
- Block vs fragment categorization
- Table handling (special case)
- Nested structural elements
- Sanitization is applied correctly

**5. Paste Coordinator Tests**
- Routes to correct handler based on data type
- Handler priority ordering works
- Read-only state enables/disables callbacks
- Native input detection bypasses custom handling
- Event is prevented when handled

**6. Integration Tests** (in `paste-coordinator.test.ts`)
- End-to-end paste flow through coordinator → handlers → BlockManager
- Multiple pastes in sequence
- Edge case: data that could match multiple handlers

---

## Migration Strategy

1. **Create new directory structure** without modifying existing code
2. **Write tests for each module** before implementation (TDD)
3. **Implement modules one at a time** starting with base (types, registry, builder)
4. **Implement handlers** in dependency order (pattern → text → files → html → blok-data)
5. **Refactor main Paste class** to use new modules
6. **Run all existing paste tests** to ensure behavior is preserved
7. **Delete old code** from `paste.ts` once verified working

---

## Success Criteria

- [ ] All new modules have unit tests with >80% coverage
- [ ] All existing paste tests pass after refactoring
- [ ] Main `Paste` class is under 200 lines
- [ ] No behavior changes detected by existing tests
- [ ] ESLint and TypeScript checks pass
- [ ] E2E tests for paste functionality pass
