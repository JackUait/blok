/**
 * Type definitions for @bloklabs/core/full entry point
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
  Marker,
  Convert,
  defaultBlockTools,
  defaultInlineTools,
  HeaderData,
  HeaderConfig,
  ParagraphData,
  ParagraphConfig,
  ListData,
  ListConfig,
  ListStyle,
} from './tools-entry';

import { Paragraph } from './tools/paragraph';
import { Header } from './tools/header';
import { List } from './tools/list';
import { InlineToolConstructable } from './tools/inline-tool';

/**
 * Default tools configuration matching pre-modularization behavior.
 * Includes Paragraph, Header, and List with inline toolbar enabled.
 */
export const defaultTools: {
  readonly paragraph: {
    readonly class: typeof Paragraph;
    readonly inlineToolbar: true;
    readonly config: { readonly preserveBlank: true };
  };
  readonly header: {
    readonly class: typeof Header;
    readonly inlineToolbar: true;
  };
  readonly list: {
    readonly class: typeof List;
    readonly inlineToolbar: true;
  };
};

/**
 * All built-in tools including inline tools.
 * For users who want every tool available.
 */
export const allTools: {
  readonly paragraph: {
    readonly class: typeof Paragraph;
    readonly inlineToolbar: true;
    readonly config: { readonly preserveBlank: true };
  };
  readonly header: {
    readonly class: typeof Header;
    readonly inlineToolbar: true;
  };
  readonly list: {
    readonly class: typeof List;
    readonly inlineToolbar: true;
  };
  readonly bold: { readonly class: InlineToolConstructable };
  readonly italic: { readonly class: InlineToolConstructable };
  readonly link: { readonly class: InlineToolConstructable };
  readonly marker: { readonly class: InlineToolConstructable };
  readonly convertTo: { readonly class: InlineToolConstructable };
};
