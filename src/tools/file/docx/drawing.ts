import type { RenderContext } from './context';
import { nested } from './context';
import { sniffImageType } from './package';
import { attr, emuToPx, find, kid } from './xml';

interface Size {
  width: number | null;
  height: number | null;
}

/** CSS pixels per unit, for the VML `style` lengths we accept. */
const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
const VML_LENGTH = /^(\d+(?:\.\d+)?)(px|pt|in|cm|mm)$/;

/** A relationship id attribute (`r:embed`, `r:id`), in the transitional or strict namespace. */
function relId(el: Element | null, name: string): string | null {
  const found = Array.from(el?.attributes ?? []).find(
    (a) => a.localName === name && (a.namespaceURI ?? '').endsWith('/relationships'),
  );

  return found?.value ?? null;
}

function setSize(el: HTMLElement, size: Size): void {
  if (size.width !== null && size.width > 0) {
    el.style.setProperty('width', `${size.width}px`);
  }
  if (size.height !== null && size.height > 0) {
    el.style.setProperty('height', `${size.height}px`);
  }
}

/** `width` and `height` from a VML `style`; every other declaration is ignored. */
function vmlSize(style: string | null): Size {
  const size: Size = { width: null, height: null };
  for (const declaration of (style ?? '').split(';')) {
    const [key, value = ''] = declaration.split(':').map((part) => part.trim().toLowerCase());
    const match = VML_LENGTH.exec(value);
    if ((key === 'width' || key === 'height') && match !== null) {
      size[key] = Math.round(Number(match[1]) * PX_PER_UNIT[match[2]]);
    }
  }

  return size;
}

async function imageUrl(path: string, ctx: RenderContext): Promise<string | null> {
  const bytes = await ctx.pkg.bytes(path);
  // The type comes from the bytes only: a part named .png may hold HTML or SVG.
  const type = bytes === null ? null : sniffImageType(bytes);
  if (bytes === null || type === null) {
    return null;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  ctx.resources.urls.push(url);

  return url;
}

/** One blob URL per image part, however many times the document shows it. */
function sharedImageUrl(path: string, ctx: RenderContext): Promise<string | null> {
  const known = ctx.resources.images.get(path);
  if (known !== undefined) {
    return known;
  }
  const loading = imageUrl(path, ctx);
  ctx.resources.images.set(path, loading);

  return loading;
}

async function loadImage(path: string, box: HTMLElement, size: Size, alt: string, ctx: RenderContext): Promise<void> {
  const url = await sharedImageUrl(path, ctx);
  if (url === null) {
    return;
  }
  const img = document.createElement('img');
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  if (size.width !== null && size.width > 0) {
    img.width = size.width;
  }
  if (size.height !== null && size.height > 0) {
    img.height = size.height;
  }
  img.style.setProperty('display', 'block');
  img.src = url;
  box.appendChild(img);
}

/**
 * A sized box that the picture fills once its bytes are read. Pictures that are
 * not a raster image (EMF, WMF, SVG…) leave the box empty, so the text around
 * them keeps the place Word gave it. External targets are never fetched.
 */
function picture(id: string | null, size: Size, alt: string, block: boolean, ctx: RenderContext): HTMLElement | null {
  const rel = id === null ? undefined : ctx.rels.find((r) => r.id === id);
  if (rel === undefined || rel.external) {
    return null;
  }
  const box = document.createElement('span');
  box.style.setProperty('display', block ? 'block' : 'inline-block');
  setSize(box, size);
  ctx.resources.tasks.push(loadImage(rel.target, box, size, alt, ctx));

  return box;
}

/** The text of a text box; the shape's fill and outline are not painted. */
function textBox(content: Element, width: number | null, ctx: RenderContext): HTMLElement {
  const box = document.createElement('div');
  box.style.setProperty('display', 'inline-block');
  box.style.setProperty('vertical-align', 'top');
  setSize(box, { width, height: null });
  box.append(...ctx.blocks(content, nested(ctx)));

  return box;
}

/** `wp:inline` or `wp:anchor`. Anchored drawings stay in the text flow. */
function renderFrame(frame: Element, ctx: RenderContext): HTMLElement | null {
  const extent = kid(frame, 'extent');
  const size = { width: emuToPx(attr(extent, 'cx')), height: emuToPx(attr(extent, 'cy')) };
  const data = kid(kid(frame, 'graphic'), 'graphicData');
  const pic = kid(data, 'pic');
  if (pic !== null) {
    const blip = kid(kid(pic, 'blipFill'), 'blip');
    const alt = attr(kid(frame, 'docPr'), 'descr') ?? '';

    return picture(relId(blip, 'embed'), size, alt, kid(frame, 'wrapTopAndBottom') !== null, ctx);
  }
  const content = kid(kid(kid(data, 'wsp'), 'txbx'), 'txbxContent');

  return content === null ? null : textBox(content, size.width, ctx);
}

/** VML (`w:pict`, `w:object`): a picture via `v:imagedata`, or a `v:textbox`. */
function renderVml(el: Element, ctx: RenderContext): HTMLElement | null {
  const imagedata = find(el, 'imagedata');
  if (imagedata !== null) {
    const shape = imagedata.parentElement;

    return picture(relId(imagedata, 'id'), vmlSize(attr(shape, 'style')), attr(shape, 'alt') ?? '', false, ctx);
  }
  const textbox = find(el, 'textbox');
  const content = kid(textbox, 'txbxContent');

  return content === null ? null : textBox(content, vmlSize(attr(textbox?.parentElement, 'style')).width, ctx);
}

/** Render a `w:drawing`, `w:pict` or `w:object`: images and text boxes. */
export function renderDrawing(el: Element, ctx: RenderContext): HTMLElement | null {
  if (el.localName !== 'drawing') {
    return renderVml(el, ctx);
  }
  const frame = kid(el, 'inline') ?? kid(el, 'anchor');

  return frame === null ? null : renderFrame(frame, ctx);
}
