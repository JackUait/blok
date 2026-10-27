// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/**
 * DrawingML reflection rendering.
 *
 * A reflected copy is kept in the shape's local coordinate system so an
 * absolutely positioned shape does not accidentally apply its slide offset a
 * second time. The alpha ramp lives on a separate, untransformed layer; this
 * preserves OOXML fade direction when the reflected content has a negative
 * vertical scale.
 */

import { SafeXmlNode } from '../parser/XmlParser';
import { emuToPx } from '../parser/units';

const MAX_ABSOLUTE_SCALE = 16;
const MAX_ABSOLUTE_SKEW = 16;
const MAX_BLUR_PX = 512;

let reflectionCloneSequence = 0;

interface Point {
  x: number;
  y: number;
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedAngleDegrees(ooxmlAngle: number): number {
  const degrees = ooxmlAngle / 60000;
  return ((degrees % 360) + 360) % 360;
}

function cssNumber(value: number): string {
  const rounded = Math.abs(value) < 0.00005 ? 0 : Number(value.toFixed(4));
  return String(rounded);
}

function alignmentAnchor(alignment: string, width: number, height: number): Point {
  const horizontal =
    alignment.endsWith('l') || alignment === 'l'
      ? 0
      : alignment.endsWith('r') || alignment === 'r'
        ? width
        : width / 2;
  const vertical =
    alignment.startsWith('t') || alignment === 't'
      ? 0
      : alignment.startsWith('b') || alignment === 'b'
        ? height
        : height / 2;
  return { x: horizontal, y: vertical };
}

function transformedPoint(matrix: Matrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function rewriteCloneIds(root: HTMLElement): void {
  const suffix = `-reflection-${++reflectionCloneSequence}`;
  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('[id]'))];
  const replacements = new Map<string, string>();

  for (const element of elements) {
    const id = element.id;
    if (!id) continue;
    const replacement = `${id}${suffix}`;
    replacements.set(id, replacement);
    element.id = replacement;
  }

  if (replacements.size === 0) return;
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value.replace(/url\(#([^)]+)\)/g, (match, id: string) => {
        const replacement = replacements.get(id);
        return replacement ? `url(#${replacement})` : match;
      });
      if (value.startsWith('#')) {
        const replacement = replacements.get(value.slice(1));
        if (replacement) value = `#${replacement}`;
      }
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
}

function cloneVisualSource(wrapper: HTMLElement, width: number, height: number): HTMLElement {
  const clone = wrapper.cloneNode(true) as HTMLElement;
  clone.dataset.pptxReflectionSource = 'true';
  clone.setAttribute('aria-hidden', 'true');
  clone.style.position = 'absolute';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.width = `${cssNumber(width)}px`;
  clone.style.height = `${cssNumber(height)}px`;
  clone.style.pointerEvents = 'none';
  clone.style.removeProperty('-webkit-box-reflect');
  rewriteCloneIds(clone);
  return clone;
}

function setMask(element: HTMLElement, mask: string): void {
  element.style.setProperty('-webkit-mask-image', mask);
  element.style.setProperty('mask-image', mask);
  element.style.setProperty('-webkit-mask-repeat', 'no-repeat');
  element.style.setProperty('mask-repeat', 'no-repeat');
  element.style.setProperty('-webkit-mask-size', '100% 100%');
  element.style.setProperty('mask-size', '100% 100%');
}

function alphaMask(
  angle: number,
  startAlpha: number,
  startPosition: number,
  endAlpha: number,
  endPosition: number,
): string {
  return `linear-gradient(${cssNumber(angle)}deg, rgba(255,255,255,${startAlpha.toFixed(3)}) ${startPosition.toFixed(1)}%, rgba(255,255,255,${endAlpha.toFixed(3)}) ${endPosition.toFixed(1)}%)`;
}

/**
 * Append a visual reflection of `wrapper` using CT_ReflectionEffect defaults
 * from ECMA-376 Part 1, schema type CT_ReflectionEffect.
 */
export function applyReflectionEffect(
  wrapper: HTMLElement,
  reflection: SafeXmlNode,
  size: { w: number; h: number },
): HTMLElement | undefined {
  const width = Math.max(0, size.w);
  const height = Math.max(0, size.h);
  if (!reflection.exists() || width === 0 || height === 0) return undefined;

  const blurPx = clamp(emuToPx(reflection.numAttr('blurRad') ?? 0), 0, MAX_BLUR_PX);
  const startAlpha = clamp((reflection.numAttr('stA') ?? 100000) / 100000, 0, 1);
  const startPosition = clamp((reflection.numAttr('stPos') ?? 0) / 1000, 0, 100);
  const endAlpha = clamp((reflection.numAttr('endA') ?? 0) / 100000, 0, 1);
  const endPosition = clamp((reflection.numAttr('endPos') ?? 100000) / 1000, 0, 100);
  const distancePx = Math.max(0, emuToPx(reflection.numAttr('dist') ?? 0));
  const direction = normalizedAngleDegrees(reflection.numAttr('dir') ?? 0);
  const fadeDirection = normalizedAngleDegrees(reflection.numAttr('fadeDir') ?? 5400000);
  const scaleX = clamp(
    (reflection.numAttr('sx') ?? 100000) / 100000,
    -MAX_ABSOLUTE_SCALE,
    MAX_ABSOLUTE_SCALE,
  );
  const scaleY = clamp(
    (reflection.numAttr('sy') ?? 100000) / 100000,
    -MAX_ABSOLUTE_SCALE,
    MAX_ABSOLUTE_SCALE,
  );
  const skewX = clamp(
    Math.tan((normalizedAngleDegrees(reflection.numAttr('kx') ?? 0) * Math.PI) / 180),
    -MAX_ABSOLUTE_SKEW,
    MAX_ABSOLUTE_SKEW,
  );
  const skewY = clamp(
    Math.tan((normalizedAngleDegrees(reflection.numAttr('ky') ?? 0) * Math.PI) / 180),
    -MAX_ABSOLUTE_SKEW,
    MAX_ABSOLUTE_SKEW,
  );
  const anchor = alignmentAnchor((reflection.attr('algn') ?? 'b').toLowerCase(), width, height);
  const directionRadians = (direction * Math.PI) / 180;
  const offsetX = distancePx * Math.cos(directionRadians);
  const offsetY = distancePx * Math.sin(directionRadians);
  const matrix: Matrix = {
    a: scaleX,
    b: skewY,
    c: skewX,
    d: scaleY,
    e: anchor.x + offsetX - scaleX * anchor.x - skewX * anchor.y,
    f: anchor.y + offsetY - skewY * anchor.x - scaleY * anchor.y,
  };
  const corners = [
    transformedPoint(matrix, { x: 0, y: 0 }),
    transformedPoint(matrix, { x: width, y: 0 }),
    transformedPoint(matrix, { x: 0, y: height }),
    transformedPoint(matrix, { x: width, y: height }),
  ];
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));

  const layer = document.createElement('div');
  layer.dataset.pptxReflectionLayer = 'true';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.position = 'absolute';
  layer.style.left = `${cssNumber(minX)}px`;
  layer.style.top = `${cssNumber(minY)}px`;
  layer.style.width = `${cssNumber(Math.max(0, maxX - minX))}px`;
  layer.style.height = `${cssNumber(Math.max(0, maxY - minY))}px`;
  layer.style.overflow = 'visible';
  layer.style.pointerEvents = 'none';
  if (blurPx > 0) layer.style.filter = `blur(${cssNumber(blurPx)}px)`;

  // OOXML angles use 0 degrees along +x and increase clockwise. CSS gradient
  // angles use 0 degrees upward, hence the 90 degree basis conversion.
  const cssFadeAngle = (fadeDirection + 90) % 360;
  const source = cloneVisualSource(wrapper, width, height);
  source.style.transformOrigin = '0 0';
  source.style.transform = `matrix(${cssNumber(matrix.a)}, ${cssNumber(matrix.b)}, ${cssNumber(matrix.c)}, ${cssNumber(matrix.d)}, ${cssNumber(matrix.e - minX)}, ${cssNumber(matrix.f - minY)})`;
  setMask(layer, alphaMask(cssFadeAngle, startAlpha, startPosition, endAlpha, endPosition));
  layer.appendChild(source);
  wrapper.insertBefore(layer, wrapper.firstChild);
  return layer;
}
