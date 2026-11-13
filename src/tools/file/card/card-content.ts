import type { FileConfig, FileData } from '../../../../types/tools/file';
import { tokenizePrism } from '../../code/prism-loader';
import { extToPrismLang } from '../code-languages';
import { parseCsv } from '../csv-view';
import type { FileIconCategory } from '../file-icon';
import { loadDocxRenderer, loadPptxFirstSlide } from '../office-loaders';
import { readWorkbook } from '../office-preview';
import { loadPdfJs, supportsPdfJs } from '../pdf/pdf-loader';
import { assetParams, CANVAS_MAX_AREA_IN_BYTES, sourceParams, type PdfSource } from '../pdf/pdf-preview';
import { resolvePdfSources } from '../pdf/pdf-source';
import type { PdfDocumentLike } from '../pdf/pdf-types';
import { extOf } from '../preview';
import type { GridCell } from '../sheet-grid';
import { safePreviewSrc } from '../url';
import { titleOf, type CardContent } from './card-objects';

/** A number the card's second line shows next to the size, e.g. "14 pages". */
export type CardCount =
  | { unit: 'pages' | 'lines' | 'sheets' | 'slides' | 'files'; value: number }
  | { unit: 'plain'; text: string };

export interface LoadedCard {
  content: CardContent;
  count?: CardCount;
  /** Frees what the content holds: blob urls, a decoded deck. */
  release?: () => void;
}

export interface CardSource {
  data: Pick<FileData, 'url' | 'fileName' | 'size' | 'mimeType'>;
  config: Pick<FileConfig, 'fetchPreview' | 'pdfAssetsUrl' | 'previewEndpoint'>;
  signal: AbortSignal;
}

/** Bytes of text a card reads; the rest of the file is never downloaded. */
export const HEAD_BYTES = 4096;
/** Largest office file or PDF a card downloads whole. Bigger ones keep the plain card. */
export const MAX_WHOLE_BYTES = 20 * 1024 * 1024;
const CODE_LINES = 14;
const TEXT_LINES = 16;
/** A Markdown file often opens with a logo and badges, which the card drops; it reads past them. */
const MARKDOWN_BYTES = 16_384;
const MARKDOWN_LINES = 200;
/** Longest line kept; the sheet shows about forty characters. */
const LINE_CHARS = 120;
const FRAME_COUNT = 6;
/** Frame size on the strip, in CSS px. Matches `.blok-file-track` in file.css. */
const FRAME_WIDTH = 62;
const FRAME_HEIGHT = 38;
/** Sheet width in CSS px, and the height of it a card can ever show. */
const SHEET_WIDTH = 180;
const SHEET_HEIGHT = 150;
const PX_PER_PT = 96 / 72;
/** A zip's end record is 22 bytes plus a comment of at most 65,535. */
const ZIP_TAIL_BYTES = 65_557;

/**
 * The url to read, or null unless it is http(s) or blob. A relative url is
 * read against the page, as fetch would.
 *
 * Requests keep fetch's default credentials on purpose: a host that serves its
 * own files behind a cookie must still get a card. That is the reach an image
 * block's <img> already has; cross-origin requests carry no cookie.
 */
export function cardSrc(raw: string): string | null {
  try {
    const url = new URL(raw, window.location.href);

    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface Head {
  bytes: Uint8Array;
  /** The whole file fit in what was read. */
  complete: boolean;
}

function joinChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  chunks.reduce((offset, chunk) => {
    out.set(chunk, offset);

    return offset + chunk.length;
  }, 0);

  return out;
}

/**
 * Reads the body until `stop` says so, then cancels the download.
 * Null when the body grows past `limit`.
 */
async function readBody(
  response: Response,
  enough: (length: number) => boolean,
  limit: number,
): Promise<{ bytes: Uint8Array; ended: boolean } | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    return bytes.length > limit ? null : { bytes, ended: true };
  }
  const chunks: Uint8Array[] = [];
  const state = { length: 0, ended: false };
  while (!state.ended && !enough(state.length)) {
    const { done, value } = await reader.read();
    if (done) {
      state.ended = true;
    } else {
      chunks.push(value);
      state.length += value.length;
    }
    if (state.length > limit) {
      await reader.cancel().catch(() => undefined);

      return null;
    }
  }
  if (!state.ended) {
    // Stops the download: the card only needed the start.
    await reader.cancel().catch(() => undefined);
  }

  return { bytes: joinChunks(chunks, state.length), ended: state.ended };
}

/** The first `max` bytes of a file, without downloading the rest. Null when it cannot be read. */
export async function readHead(url: string, max: number, signal: AbortSignal): Promise<Head | null> {
  const src = cardSrc(url);
  if (src === null) {
    return null;
  }
  try {
    const response = await fetch(src, { signal, referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      return null;
    }
    const body = await readBody(response, (length) => length >= max, Infinity);
    if (body === null) {
      return null;
    }

    return { bytes: body.bytes.subarray(0, max), complete: body.ended && body.bytes.length <= max };
  } catch {
    return null;
  }
}

/** A whole file, or null when it cannot be read or is larger than the card downloads. */
export async function readWhole(source: CardSource): Promise<ArrayBuffer | null> {
  const src = cardSrc(source.data.url);
  if (src === null || (source.data.size ?? 0) > MAX_WHOLE_BYTES) {
    return null;
  }
  try {
    const response = await fetch(src, { signal: source.signal, referrerPolicy: 'no-referrer' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_WHOLE_BYTES) {
      await response.body?.cancel().catch(() => undefined);

      return null;
    }
    const body = await readBody(response, () => false, MAX_WHOLE_BYTES);

    return body === null ? null : (body.bytes.buffer as ArrayBuffer);
  } catch {
    return null;
  }
}

/** The first lines of a text file. A cut-off last line is dropped unless it is the only one. */
export function headLines(head: Head, max: number, lineChars = LINE_CHARS): { lines: string[]; total: number | null } {
  const text = new TextDecoder().decode(head.bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const all = text.split('\n');
  if (head.complete && all[all.length - 1] === '') {
    all.pop();
  }
  const whole = head.complete || all.length === 1 ? all : all.slice(0, -1);

  return {
    lines: whole.slice(0, max).map((line) => line.slice(0, lineChars)),
    total: head.complete ? all.length : null,
  };
}

/** "1:08" or "1:02:05". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Entries in a zip, read from its end record. Null when `tail` holds no end record. */
export function zipEntryCount(tail: Uint8Array): number | null {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const starts = Array.from({ length: Math.max(0, tail.length - 21) }, (_, i) => tail.length - 22 - i);
  const at = starts.find((offset) => view.getUint32(offset, true) === 0x06054b50);
  if (at === undefined) {
    return null;
  }
  const count = view.getUint16(at + 10, true);

  // 0xFFFF means the real count sits in the zip64 record, which the card does not read.
  return count === 0xffff ? null : count;
}

/** A `pt` length the docx renderer wrote inline, in px. 0 when absent. */
const px = (length: string): number => (parseFloat(length) || 0) * PX_PER_PT;
const nameOf = (source: CardSource): string => source.data.fileName ?? source.data.url;
const lineCount = (total: number | null): { count?: CardCount } => (total === null ? {} : { count: { unit: 'lines', value: total } });

async function loadCode(source: CardSource): Promise<LoadedCard | null> {
  const head = await readHead(source.data.url, HEAD_BYTES, source.signal);
  if (head === null) {
    return null;
  }
  const { lines, total } = headLines(head, CODE_LINES);
  if (lines.join('').trim() === '') {
    return null;
  }
  const text = lines.join('\n');
  const lang = extToPrismLang(extOf(nameOf(source))) ?? 'plain';
  const html = await tokenizePrism(text, lang);

  return {
    content: { kind: 'code', fileName: source.data.fileName ?? extOf(source.data.url), lang, text, html },
    ...lineCount(total),
  };
}

async function loadText(source: CardSource): Promise<LoadedCard | null> {
  const ext = extOf(nameOf(source));
  const markdown = source.data.mimeType === 'text/markdown' || ext === 'md' || ext === 'markdown';
  const head = await readHead(source.data.url, markdown ? MARKDOWN_BYTES : HEAD_BYTES, source.signal);
  if (head === null) {
    return null;
  }
  // Markdown lines stay whole: a cut inside an HTML tag would swallow the text after it.
  const { lines, total } = markdown ? headLines(head, MARKDOWN_LINES, Infinity) : headLines(head, TEXT_LINES);
  const text = lines.join('\n');
  if (text.trim() === '') {
    return null;
  }
  if (!markdown) {
    return { content: { kind: 'text', text }, ...lineCount(total) };
  }
  const { markdownToHtml } = await import('../../../markdown/markdownToHtml');

  return { content: { kind: 'markdown', html: await markdownToHtml(text, { baseUrl: source.data.url }) }, ...lineCount(total) };
}

const NUMBER = /^-?\d+(?:[.,]\d+)?%?$/;

async function loadSpreadsheet(source: CardSource): Promise<LoadedCard | null> {
  const ext = extOf(nameOf(source));
  if (ext === 'csv' || ext === 'tsv') {
    const head = await readHead(source.data.url, HEAD_BYTES, source.signal);
    if (head === null) {
      return null;
    }
    const parsed = parseCsv(new TextDecoder().decode(head.bytes));
    // The last row of a cut-off read may be half a row.
    const rows = (head.complete ? parsed : parsed.slice(0, -1))
      .map((row) => row.map((field): GridCell => ({ text: field, value: NUMBER.test(field.trim()) ? parseFloat(field.replace(',', '.')) : null })));

    return rows.length === 0 ? null : { content: { kind: 'spreadsheet', rows } };
  }
  if (ext !== 'xlsx' && !(source.data.mimeType ?? '').includes('spreadsheetml')) {
    return null;
  }
  const buf = await readWhole(source);
  if (buf === null) {
    return null;
  }
  const sheets = await readWorkbook(buf);
  const first = sheets.find((sheet) => sheet.rows.length > 0);

  return first === undefined
    ? null
    : { content: { kind: 'spreadsheet', rows: first.rows }, count: { unit: 'sheets', value: sheets.length } };
}

async function loadDocument(source: CardSource): Promise<LoadedCard | null> {
  if (extOf(nameOf(source)) !== 'docx' && !(source.data.mimeType ?? '').includes('wordprocessingml')) {
    return null;
  }
  const buf = await readWhole(source);
  if (buf === null) {
    return null;
  }
  const render = await loadDocxRenderer();
  const holder = document.createElement('div');
  const release = await render(buf, holder);
  const pages = holder.querySelectorAll<HTMLElement>('section.blok-docx');
  const first = pages[0];
  if (first === undefined) {
    release();

    return null;
  }
  // The docx rules in file.css hang off this class.
  const page = document.createElement('div');
  page.className = 'blok-file-preview-docx';
  page.appendChild(first);

  return {
    content: {
      kind: 'document',
      page,
      pageWidth: px(first.style.width) || 816,
      margins: { top: px(first.style.paddingTop), start: px(first.style.paddingInlineStart), end: px(first.style.paddingInlineEnd) },
    },
    count: { unit: 'pages', value: pages.length },
    release,
  };
}

async function loadPresentation(source: CardSource): Promise<LoadedCard | null> {
  if (extOf(nameOf(source)) !== 'pptx' && !(source.data.mimeType ?? '').includes('presentationml')) {
    return null;
  }
  const buf = await readWhole(source);
  if (buf === null) {
    return null;
  }
  const open = await loadPptxFirstSlide();
  const view = await open(buf, () => source.signal.aborted);
  if (view === null) {
    return null;
  }
  view.element.style.transformOrigin = 'top left';

  return {
    content: { kind: 'presentation', slide: view.element, width: view.width, height: view.height },
    count: { unit: 'slides', value: view.count },
    release: () => view.destroy(),
  };
}

/** The part of a page that holds ink, as fractions of the page. */
export interface InkBox {
  left: number;
  top: number;
  right: number;
}

/** A pixel this light or lighter is paper. */
const PAPER_LEVEL = 235;

/**
 * Finds where a page's content starts and how wide it is, so the card can
 * zoom past the margins. `pixels` is RGBA. A blank page gives the whole page.
 */
export function inkBox(pixels: Uint8ClampedArray, width: number, height: number): InkBox {
  const box = { left: width, top: height, right: -1 };
  Array.from({ length: height }, (_, y) => Array.from({ length: width }, (__, x) => {
    const at = (y * width + x) * 4;
    const ink = pixels[at + 3] > 0 && Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) < PAPER_LEVEL;
    if (ink) {
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
    }

    return ink;
  }));
  if (box.right < 0) {
    return { left: 0, top: 0, right: 1 };
  }

  return { left: box.left / width, top: box.top / height, right: (box.right + 1) / width };
}

/** Rows of the first pass: about two sheets' worth of a page's top. */
const PROBE_MAX_HEIGHT = 360;
/** Side padding around a zoomed page, in CSS px. */
const PAGE_PAD_X = 12;
/** A PDF sits this far down the sheet, so its first line clears the page mark. */
const PDF_PAD_Y = 15;

/**
 * Draws the top of page one, zoomed onto its content: a first small pass
 * finds the margins, the second draws past them at twice the sheet's size.
 */
async function drawPdfPage(doc: PdfDocumentLike): Promise<HTMLCanvasElement | null> {
  const page = await doc.getPage(1);
  const natural = page.getViewport({ scale: 1 });
  if (!(natural.width > 0) || !(natural.height > 0)) {
    return null;
  }
  const probe = document.createElement('canvas');
  const probeView = page.getViewport({ scale: SHEET_WIDTH / natural.width });
  probe.width = SHEET_WIDTH;
  // A page can claim any height. Only its top shows, so only its top is drawn.
  probe.height = Math.max(1, Math.min(Math.floor(probeView.height), PROBE_MAX_HEIGHT));
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  if (probeContext === null) {
    return null;
  }
  await page.render({ canvasContext: probeContext, viewport: probeView }).promise;
  const found = inkBox(probeContext.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height);
  // `top` came back as a share of the probe; the shift below needs a share of the page.
  const ink = { ...found, top: (found.top * probe.height) / probeView.height };

  const ratio = 2;
  const scale = ((SHEET_WIDTH - PAGE_PAD_X * 2) * ratio) / (Math.max(0.2, ink.right - ink.left) * natural.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH * ratio;
  // Only the top of the page ever shows, so the rest is not kept.
  canvas.height = SHEET_HEIGHT * ratio;
  const context = canvas.getContext('2d');
  if (context === null) {
    return null;
  }
  const shift = [1, 0, 0, 1, PAGE_PAD_X * ratio - ink.left * viewport.width, PDF_PAD_Y * ratio - ink.top * viewport.height];
  await page.render({ canvasContext: context, viewport, transform: shift }).promise;
  page.cleanup();

  return canvas;
}

async function openPdf(source: CardSource, from: PdfSource): Promise<LoadedCard | null> {
  const lib = await loadPdfJs();
  const task = lib.getDocument({
    ...sourceParams(from, lib, () => undefined),
    ...assetParams(source.config.pdfAssetsUrl),
    useSystemFonts: true,
    canvasMaxAreaInBytes: CANVAS_MAX_AREA_IN_BYTES,
    // The card draws one page: no read-ahead of the rest of the file.
    disableAutoFetch: true,
    disableStream: true,
  });
  const abort = (): void => {
    task.destroy().catch(() => undefined);
  };
  source.signal.addEventListener('abort', abort, { once: true });
  try {
    const doc = await task.promise;
    const canvas = await drawPdfPage(doc as unknown as PdfDocumentLike);

    return canvas === null ? null : { content: { kind: 'pdf', page: canvas, pages: doc.numPages }, count: { unit: 'pages', value: doc.numPages } };
  } catch {
    return null;
  } finally {
    source.signal.removeEventListener('abort', abort);
    // The picture is on the canvas; the document and its worker memory can go.
    abort();
  }
}

async function loadPdf(source: CardSource): Promise<LoadedCard | null> {
  if (!supportsPdfJs() || (source.data.size ?? 0) > MAX_WHOLE_BYTES) {
    return null;
  }
  if (cardSrc(source.data.url)?.startsWith('blob:') === true) {
    const buf = await readWhole(source);

    return buf === null ? null : openPdf(source, { kind: 'data', data: new Uint8Array(buf) });
  }
  for await (const from of resolvePdfSources(source.data.url, source.config.fetchPreview, source.signal, source.config.previewEndpoint)) {
    const loaded = await openPdf(source, from);
    if (loaded !== null || source.signal.aborted) {
      return loaded;
    }
  }

  return null;
}

async function loadImage(source: CardSource): Promise<LoadedCard | null> {
  const src = cardSrc(source.data.url);
  if (src === null) {
    return null;
  }
  const probe = new Image();
  probe.referrerPolicy = 'no-referrer';
  const loaded = await new Promise<boolean>((resolve) => {
    probe.onload = () => resolve(true);
    probe.onerror = () => resolve(false);
    source.signal.addEventListener('abort', () => resolve(false), { once: true });
    probe.src = safePreviewSrc(src) ?? '';
  });
  if (!loaded || probe.naturalWidth === 0) {
    return null;
  }

  return {
    content: { kind: 'image', src },
    count: { unit: 'plain', text: `${probe.naturalWidth} × ${probe.naturalHeight}` },
  };
}

/** Resolves once the media element fires `event`; false on error or abort. */
function mediaEvent(media: HTMLMediaElement, event: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => (): void => {
      media.removeEventListener(event, yes);
      media.removeEventListener('error', no);
      signal.removeEventListener('abort', no);
      resolve(ok);
    };
    const yes = done(true);
    const no = done(false);
    media.addEventListener(event, yes);
    media.addEventListener('error', no);
    signal.addEventListener('abort', no);
  });
}

function releaseMedia(media: HTMLMediaElement): void {
  media.removeAttribute('src');
  // Without load() the browser keeps the download open.
  media.load();
}

async function mediaDuration(media: HTMLMediaElement, src: string, signal: AbortSignal): Promise<number | null> {
  // eslint-disable-next-line no-param-reassign -- configuring the element is this helper's job
  media.preload = 'metadata';
  const ready = mediaEvent(media, 'loadedmetadata', signal);
  // eslint-disable-next-line no-param-reassign -- see above
  media.src = safePreviewSrc(src) ?? '';

  return (await ready) && Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
}

/** Seeks the video and draws that moment, cropped to fill a strip frame. Null when it cannot. */
async function grabFrame(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<HTMLCanvasElement | null> {
  const seeked = mediaEvent(video, 'seeked', signal);
  // eslint-disable-next-line no-param-reassign -- seeking is how a frame is reached
  video.currentTime = time;
  if (!(await seeked) || video.videoWidth === 0) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH * 2;
  canvas.height = FRAME_HEIGHT * 2;
  const context = canvas.getContext('2d');
  if (context === null) {
    return null;
  }
  const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);

  return canvas;
}

/** Six moments, at even steps through the film; never the very start or end, which are often black. */
async function grabFrames(
  video: HTMLVideoElement,
  duration: number,
  signal: AbortSignal,
  frames: HTMLCanvasElement[] = [],
): Promise<HTMLCanvasElement[] | null> {
  if (frames.length === FRAME_COUNT) {
    return frames;
  }
  const frame = await grabFrame(video, (duration * (frames.length + 0.5)) / FRAME_COUNT, signal);

  return frame === null ? null : grabFrames(video, duration, signal, [...frames, frame]);
}

async function loadVideo(source: CardSource): Promise<LoadedCard | null> {
  const src = cardSrc(source.data.url);
  if (src === null) {
    return null;
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  try {
    const duration = await mediaDuration(video, src, source.signal);
    if (duration === null) {
      return null;
    }
    const frames = await grabFrames(video, duration, source.signal);
    if (frames === null) {
      return null;
    }

    return { content: { kind: 'video', frames }, count: { unit: 'plain', text: formatDuration(duration) } };
  } finally {
    releaseMedia(video);
  }
}

async function loadAudio(source: CardSource): Promise<LoadedCard | null> {
  const content: CardContent = { kind: 'audio', title: titleOf(source.data.fileName ?? '') };
  const src = cardSrc(source.data.url);
  if (src === null) {
    return { content };
  }
  const audio = document.createElement('audio');
  try {
    const duration = await mediaDuration(audio, src, source.signal);

    return duration === null ? { content } : { content, count: { unit: 'plain', text: formatDuration(duration) } };
  } finally {
    releaseMedia(audio);
  }
}

/** The last bytes of a file, when the server honours a suffix range. */
async function readTail(url: string, bytes: number, signal: AbortSignal): Promise<Uint8Array | null> {
  const src = cardSrc(url);
  if (src === null) {
    return null;
  }
  try {
    const response = await fetch(src, { signal, referrerPolicy: 'no-referrer', headers: { Range: `bytes=-${bytes}` } });
    // 200 means the range was ignored and the whole file is coming: not worth it for a count.
    if (response.status !== 206 && !src.startsWith('blob:')) {
      await response.body?.cancel().catch(() => undefined);

      return null;
    }
    const body = await readBody(response, () => false, bytes * 4);

    return body === null ? null : body.bytes;
  } catch {
    return null;
  }
}

async function loadArchive(source: CardSource): Promise<LoadedCard | null> {
  const content: CardContent = { kind: 'archive', title: titleOf(source.data.fileName ?? '') };
  if (extOf(nameOf(source)) !== 'zip') {
    return { content };
  }
  const tail = await readTail(source.data.url, ZIP_TAIL_BYTES, source.signal);
  const files = tail === null ? null : zipEntryCount(tail);

  return files === null ? { content } : { content, count: { unit: 'files', value: files } };
}

async function loadGeneric(source: CardSource): Promise<LoadedCard | null> {
  const head = await readHead(source.data.url, 64, source.signal);

  return { content: { kind: 'generic', title: titleOf(source.data.fileName ?? ''), bytes: head?.bytes ?? null } };
}

const LOADERS: Record<FileIconCategory, (source: CardSource) => Promise<LoadedCard | null>> = {
  pdf: loadPdf,
  document: loadDocument,
  spreadsheet: loadSpreadsheet,
  presentation: loadPresentation,
  archive: loadArchive,
  audio: loadAudio,
  video: loadVideo,
  image: loadImage,
  code: loadCode,
  text: loadText,
  generic: loadGeneric,
};

/** What the card shows before anything is read, for files drawn as a container. */
export function initialContent(category: FileIconCategory, fileName: string | undefined): CardContent | null {
  const title = titleOf(fileName ?? '');
  if (category === 'audio') {
    return { kind: 'audio', title };
  }
  if (category === 'archive') {
    return { kind: 'archive', title };
  }

  return category === 'generic' ? { kind: 'generic', title, bytes: null } : null;
}

const queue: { running: number; waiting: Array<() => void> } = { running: 0, waiting: [] };
/** Files read at once, so a page of attachments does not open a dozen downloads. */
const MAX_PARALLEL = 2;

async function takeTurn(signal: AbortSignal): Promise<boolean> {
  if (queue.running >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => {
      queue.waiting.push(resolve);
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
  if (signal.aborted) {
    return false;
  }
  queue.running += 1;

  return true;
}

function endTurn(): void {
  queue.running -= 1;
  queue.waiting.shift()?.();
}

/**
 * Reads what a card shows from the file itself. Null when the file cannot be
 * read, is too large, or has no reader: the card then stays as it is.
 */
export async function loadCardContent(category: FileIconCategory, source: CardSource): Promise<LoadedCard | null> {
  if (!(await takeTurn(source.signal))) {
    return null;
  }
  try {
    const loaded = await LOADERS[category](source);
    if (source.signal.aborted) {
      loaded?.release?.();

      return null;
    }

    return loaded;
  } catch {
    return null;
  } finally {
    endTurn();
  }
}
