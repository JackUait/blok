/**
 * Record tracking a collapsed bold exit state
 */
export interface CollapsedExitRecord {
  boundary: Text;
  boldElement: HTMLElement;
  allowedLength: number;
  hasLeadingSpace: boolean;
  hasTypedContent: boolean;
  leadingWhitespace: string;
}
