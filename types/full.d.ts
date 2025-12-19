/**
 * Type definitions for @jackuait/blok/full entry point
 * Full bundle with Blok core + all built-in tools
 */

// Re-export everything from core
export { Blok, version, DATA_ATTR } from './index';

// Re-export all types from core
export * from './index';

// Re-export all tools
export {
  Paragraph,
  Header,
  List,
  Bold,
  Italic,
  Link,
  Convert,
  Delete,
  defaultBlockTools,
  defaultInlineTools,
  HeaderData,
  HeaderConfig,
  ParagraphData,
  ParagraphConfig,
  ListData,
  ListConfig,
  ListStyle,
} from './tools';

import { ParagraphConstructable } from './tools/paragraph';
import { HeaderConstructable } from './tools/header';
import { ListConstructable } from './tools/list';
import { InlineToolConstructable } from './tools/inline-tool';

/**
 * Default tools configuration matching pre-modularization behavior.
 * Includes Paragraph, Header, and List with inline toolbar enabled.
 */
export const defaultTools: {
  readonly paragraph: {
    readonly class: ParagraphConstructable;
    readonly inlineToolbar: true;
    readonly config: { readonly preserveBlank: true };
  };
  readonly header: {
    readonly class: HeaderConstructable;
    readonly inlineToolbar: true;
  };
  readonly list: {
    readonly class: ListConstructable;
    readonly inlineToolbar: true;
  };
};

/**
 * All built-in tools including inline tools.
 * For users who want every tool available.
 */
export const allTools: {
  readonly paragraph: {
    readonly class: ParagraphConstructable;
    readonly inlineToolbar: true;
    readonly config: { readonly preserveBlank: true };
  };
  readonly header: {
    readonly class: HeaderConstructable;
    readonly inlineToolbar: true;
  };
  readonly list: {
    readonly class: ListConstructable;
    readonly inlineToolbar: true;
  };
  readonly bold: { readonly class: InlineToolConstructable };
  readonly italic: { readonly class: InlineToolConstructable };
  readonly link: { readonly class: InlineToolConstructable };
  readonly convertTo: { readonly class: InlineToolConstructable };
};
