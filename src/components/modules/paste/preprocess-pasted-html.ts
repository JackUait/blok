import { preprocessGoogleDocsHtml } from './google-docs-preprocessor';
import { preprocessNotionHtml } from './notion-preprocessor';
import { preprocessAiChatHtml } from './ai-chat-preprocessor';
import { recoverGfmToggles } from './gfm-toggle-recovery';
import { preprocessDivLines } from './div-lines-preprocessor';
import { stampPastedTableDirection } from './table-direction-preprocessor';
import { preprocessExcelClassStyles } from './excel-class-styles-preprocessor';
import { preprocessWordLists } from './word-list-preprocessor';
import { preprocessTableCellFormatting } from './table-cell-format-preprocessor';
import { protectPastedCellBlocks } from '../../../tools/table/table-cell-paste';

/**
 * Every pre-pass raw clipboard HTML needs before it is sanitized. The paste
 * module and the table's paste-into-cells route both call this, so a pass
 * added here reaches both.
 *
 * @param options.keepTables - the paste lands in a table cell: no table is
 *   read as a page layout and unwrapped
 */
export const preprocessPastedHtml = (html: string, options: { keepTables?: boolean } = {}): string =>
  // After preprocessDivLines: it turns a <pre>'s line divs into the <br>s protectPastedCellBlocks reads.
  // stampPastedTableDirection first: the passes after it drop <body dir>.
  // Excel and Word passes before the Docs pass: it turns cell <p>s into <br> lines.
  protectPastedCellBlocks(preprocessDivLines(recoverGfmToggles(preprocessNotionHtml(preprocessAiChatHtml(
    preprocessGoogleDocsHtml(preprocessTableCellFormatting(preprocessWordLists(preprocessExcelClassStyles(stampPastedTableDirection(html)))), options)
  )))));
