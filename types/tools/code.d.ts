import { BlockToolData } from './block-tool-data';

/**
 * Code block tool data format.
 */
export interface CodeData extends BlockToolData {
  /** Raw code text (not HTML) */
  code: string;
  /** Language identifier, e.g. "javascript", "plain text" */
  language: string;
}
