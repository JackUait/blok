import JSZip from 'jszip';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Namespaces every generated part declares, so bodies can use any prefix. */
const NAMESPACES = [
  `xmlns:w="${W_NS}"`,
  `xmlns:r="${R_NS}"`,
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
].join(' ');

export interface DocxRel {
  id: string;
  /** Short relationship type, e.g. 'image', 'hyperlink', 'header'. */
  type: string;
  target: string;
  external?: boolean;
}

export interface DocxParts {
  /** Inner XML of `<w:body>`. */
  body: string;
  /** Inner XML of `<w:styles>`. */
  styles?: string;
  /** Inner XML of `<w:numbering>`. */
  numbering?: string;
  /** Inner XML of `<w:settings>`. */
  settings?: string;
  /** Inner XML of `<w:footnotes>`. */
  footnotes?: string;
  /** Inner XML of `<w:endnotes>`. */
  endnotes?: string;
  /** Full theme1.xml text. */
  theme?: string;
  /** Extra relationships of word/document.xml. */
  rels?: DocxRel[];
  /** Extra raw files, keyed by zip path (e.g. headers, media). */
  files?: Record<string, string | Uint8Array>;
}

const relXml = (rels: DocxRel[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
    rels.map((rel) =>
      `<Relationship Id="${rel.id}" Type="${REL_BASE}/${rel.type}" Target="${rel.target}"${rel.external === true ? ' TargetMode="External"' : ''}/>`,
    ).join('')
  }</Relationships>`;

/** Wrap inner XML in a root element that declares every namespace. */
export const part = (root: string, inner: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><w:${root} ${NAMESPACES}>${inner}</w:${root}>`;

/** Build a .docx (as an ArrayBuffer) from the given parts. */
export async function buildDocx(parts: DocxParts): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const rels: DocxRel[] = [...(parts.rels ?? [])];
  const optional: Array<[keyof DocxParts, string, string]> = [
    ['styles', 'styles', 'styles.xml'],
    ['numbering', 'numbering', 'numbering.xml'],
    ['settings', 'settings', 'settings.xml'],
    ['footnotes', 'footnotes', 'footnotes.xml'],
    ['endnotes', 'endnotes', 'endnotes.xml'],
  ];

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('_rels/.rels', relXml([{ id: 'rId1', type: 'officeDocument', target: 'word/document.xml' }]));

  for (const [key, root, file] of optional) {
    const inner = parts[key];
    if (typeof inner === 'string') {
      zip.file(`word/${file}`, part(root, inner));
      rels.push({ id: `rIdAuto${root}`, type: root, target: file });
    }
  }
  if (parts.theme !== undefined) {
    zip.file('word/theme/theme1.xml', parts.theme);
    rels.push({ id: 'rIdAutoTheme', type: 'theme', target: 'theme/theme1.xml' });
  }
  for (const [path, content] of Object.entries(parts.files ?? {})) {
    zip.file(path, content);
  }

  zip.file('word/_rels/document.xml.rels', relXml(rels));
  zip.file('word/document.xml', part('document', `<w:body>${parts.body}</w:body>`));

  return zip.generateAsync({ type: 'arraybuffer' });
}

/** Shorthand for a paragraph holding one plain run. */
export const p = (text: string, pPr = '', rPr = ''): string =>
  `<w:p>${pPr === '' ? '' : `<w:pPr>${pPr}</w:pPr>`}<w:r>${rPr === '' ? '' : `<w:rPr>${rPr}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** 1×1 transparent PNG. */
export const PNG_1X1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
