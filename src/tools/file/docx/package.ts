import type { ZipArchive } from '../zip/read-zip';
import { ZipParts } from '../zip-parts';
import { attr, kids } from './xml';

export interface Relationship {
  id: string;
  /** Last segment of the relationship type URI, e.g. `image`, `hyperlink`. */
  type: string;
  /** Zip path for internal targets, the raw URI for external ones. */
  target: string;
  external: boolean;
}

/** Image types an `<img>` can show, keyed by their leading bytes. */
const IMAGE_SIGNATURES: Array<[string, number[]]> = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['image/bmp', [0x42, 0x4d]],
];

/**
 * The MIME type of raster image bytes, read from their signature. The type the
 * package declares is never trusted: a part named .png may hold HTML or SVG.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const isWebp = bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  if (isWebp) {
    return 'image/webp';
  }
  const match = IMAGE_SIGNATURES.find(([, sig]) => sig.every((byte, i) => bytes[i] === byte));

  return match === undefined ? null : match[0];
}

/** Resolve a relationship target against the folder of the part that owns it. */
export function resolvePath(target: string, fromFolder: string): string {
  const segments = (target.startsWith('/') ? target.slice(1) : `${fromFolder}${target}`).split('/');
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '..') {
      out.pop();
    } else if (segment !== '.' && segment !== '') {
      out.push(segment);
    }
  }

  return out.join('/');
}

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);
const relsPathOf = (path: string): string => `${folderOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;


/** Read access to the parts of an opened .docx package. */
export class DocxPackage extends ZipParts {
  private readonly relsCache = new Map<string, Promise<Relationship[]>>();

  private constructor(zip: ZipArchive, readonly mainPath: string) {
    super(zip);
  }

  static override async open(buf: ArrayBuffer): Promise<DocxPackage> {
    const zip = await ZipParts.load(buf);
    const probe = new DocxPackage(zip, '');
    const rootRels = await probe.rels('');
    const main = rootRels.find((rel) => rel.type === 'officeDocument' && !rel.external)?.target ?? 'word/document.xml';

    if (!probe.has(main)) {
      throw new Error('docx: package has no main document part');
    }

    return new DocxPackage(zip, main);
  }

  /** Relationships of a part (`''` for the package root). */
  rels(partPath: string): Promise<Relationship[]> {
    const cached = this.relsCache.get(partPath);
    if (cached !== undefined) {
      return cached;
    }
    const loading = this.loadRels(partPath);
    this.relsCache.set(partPath, loading);

    return loading;
  }

  private async loadRels(partPath: string): Promise<Relationship[]> {
    const relsPath = partPath === '' ? '_rels/.rels' : relsPathOf(partPath);
    // Broken relationships cost the links and pictures of one part, not the preview.
    const doc = await this.optionalXml(relsPath);
    if (doc === null) {
      return [];
    }
    const folder = folderOf(partPath);

    return kids(doc.documentElement, 'Relationship').map((el) => {
      const external = attr(el, 'TargetMode') === 'External';
      const target = attr(el, 'Target') ?? '';
      const type = attr(el, 'Type') ?? '';

      return {
        id: attr(el, 'Id') ?? '',
        type: type.slice(type.lastIndexOf('/') + 1),
        target: external ? target : resolvePath(target, folder),
        external,
      };
    });
  }
}
