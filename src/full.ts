/**
 * @module Blok/Full
 * Full bundle with Blok core + all built-in tools.
 * Use this for batteries-included setup (same as pre-modularization behavior).
 *
 * @example
 * import { Blok, defaultTools, defaultInlineTools } from '@jackuait/blok/full';
 *
 * new Blok({
 *   holder: 'editor',
 *   tools: defaultTools,
 *   inlineTools: defaultInlineTools,
 * });
 */

// Re-export everything from core
// Import tools for defaultTools object
import { BoldInlineTool as Bold } from './components/inline-tools/inline-tool-bold';
import { ItalicInlineTool as Italic } from './components/inline-tools/inline-tool-italic';
import { LinkInlineTool as Link } from './components/inline-tools/inline-tool-link';
import { Header } from './tools/header';
import { ListItem as List } from './tools/list';
import { Paragraph } from './tools/paragraph';

export { Blok, version, DATA_ATTR } from './blok';

// Re-export all tools
export {
  Paragraph,
  Header,
  List,
  Toggle,
  Bold,
  Italic,
  Link,
  defaultBlockTools,
  defaultInlineTools,
} from './tools';

/**
 * Default tools configuration matching pre-modularization behavior.
 * Includes Paragraph, Header, and List with inline toolbar enabled.
 */
export const defaultTools = {
  paragraph: {
    class: Paragraph,
    inlineToolbar: true,
    config: { preserveBlank: true },
  },
  header: {
    class: Header,
    inlineToolbar: true,
  },
  list: {
    class: List,
    inlineToolbar: true,
  },
} as const;

/**
 * All built-in tools including inline tools.
 * For users who want every tool available.
 * Note: Convert and Delete are internal tools and don't need to be configured.
 */
export const allTools = {
  ...defaultTools,
  bold: { class: Bold },
  italic: { class: Italic },
  link: { class: Link },
} as const;
