/*
 * The slice of pdf.js the viewer uses, written by hand so tests can fake it
 * and nothing here imports pdfjs-dist.
 */

export interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  /** PDF rect to viewport px, rotation and page offset included. */
  convertToViewportRectangle?(rect: number[]): number[];
}

export interface PdfRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfPageLike {
  getViewport(o: { scale: number }): PdfViewport;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; transform?: number[] }): PdfRenderTask;
  getTextContent(): Promise<unknown>;
  getAnnotations(): Promise<PdfAnnotationLike[]>;
  cleanup(): void;
}

export interface PdfAnnotationLike {
  subtype: string;
  rect: number[];
  url?: string;
  dest?: unknown;
  /** The page text under a link, read by pdf.js. */
  overlaidText?: string;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  getPageIndex?(ref: unknown): Promise<number>;
  getDestination?(name: string): Promise<unknown[] | null>;
}
