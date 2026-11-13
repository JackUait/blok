/** Bytes arrived but are no readable PDF: the source chain stops on the error card. */
export class PdfUnreadableError extends Error {
  public override readonly name = 'PdfUnreadableError';
}
