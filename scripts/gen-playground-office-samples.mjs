// Generates realistic OOXML sample documents for the playground File-block
// states (Word / Spreadsheet / Presentation). Unlike the minimal e2e fixtures
// in test/playwright/fixtures/office, these carry real, human-readable content
// so the inline office preview shows something meaningful.
//
//   node scripts/gen-playground-office-samples.mjs
//
// Outputs land in public/samples/ and are served by Vite at /samples/* (same
// origin, no CORS) in both dev and the built playground. Assembled by hand as
// OOXML ZIPs via JSZip — no spreadsheet/word/pptx authoring library needed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
mkdirSync(OUT, { recursive: true });

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// ---- docx: a short service agreement -------------------------------------
const docxPara = (text, { bold = false, heading = false } = {}) => {
  // Heading = the document title; bold = a numbered section header; otherwise body.
  const spacing = heading
    ? '<w:spacing w:after="240" w:line="276" w:lineRule="auto"/>'
    : bold
      ? '<w:spacing w:before="280" w:after="80" w:line="276" w:lineRule="auto"/>'
      : '<w:spacing w:after="160" w:line="276" w:lineRule="auto"/>';
  const pPr = `<w:pPr>${spacing}</w:pPr>`;
  const rPr = bold || heading ? `<w:rPr><w:b/>${heading ? '<w:sz w:val="40"/>' : '<w:sz w:val="24"/>'}</w:rPr>` : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
};

const docxBody = [
  docxPara('Service Agreement', { heading: true }),
  docxPara(
    'This Service Agreement ("Agreement") is entered into as of June 16, 2026, by and between Blok Software Inc. ("Provider") and the undersigned client ("Client").',
  ),
  docxPara('1. Scope of Services', { bold: true }),
  docxPara(
    'Provider shall deliver and maintain the Blok block-based editor, including hosting, support, and periodic feature updates, for the duration of this Agreement.',
  ),
  docxPara('2. Term', { bold: true }),
  docxPara(
    'This Agreement commences on the effective date above and continues for an initial term of twelve (12) months, renewing automatically unless either party provides thirty (30) days written notice.',
  ),
  docxPara('3. Fees', { bold: true }),
  docxPara(
    'Client agrees to pay the monthly subscription fee set out in the order form. Fees are due within fifteen (15) days of each invoice date.',
  ),
  docxPara('4. Confidentiality', { bold: true }),
  docxPara(
    'Each party shall protect the other party’s confidential information with the same degree of care it uses for its own, and no less than reasonable care.',
  ),
].join('');

const docx = new JSZip();
docx.file(
  '[Content_Types].xml',
  `${XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
);
docx.file(
  '_rels/.rels',
  `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
);
docx.file(
  'word/document.xml',
  `${XML}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${docxBody}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`,
);
writeFileSync(join(OUT, 'service-agreement.docx'), await docx.generateAsync({ type: 'nodebuffer' }));

// ---- xlsx: a quarterly budget --------------------------------------------
// 2D grid; strings become shared strings, numbers stay inline numeric. The
// data rows are generated deterministically (no RNG, so the fixture is stable)
// across many teams and metric columns to exercise a realistically wide sheet.
const HEADER = ['Department', 'Q1', 'Q2', 'Q3', 'Q4', 'FY Total', 'Prior FY', 'YoY %', 'Headcount'];
const DEPARTMENTS = [
  'Engineering', 'Platform', 'Mobile', 'Data & ML', 'Security',
  'Design', 'Product', 'Marketing', 'Growth', 'Sales',
  'Customer Success', 'Support', 'Finance', 'People Ops', 'Recruiting',
  'Legal', 'IT', 'Facilities', 'Operations', 'Research',
  'Partnerships', 'Procurement',
];
const dataRows = DEPARTMENTS.map((name, i) => {
  const base = 40000 + i * 6500;
  const quarters = [0, 1, 2, 3].map((q) => base + q * 3200 + ((i * (q + 1) * 131) % 9000));
  const fyTotal = quarters.reduce((a, b) => a + b, 0);
  const priorFY = Math.round(fyTotal / (1.05 + (i % 6) * 0.015));
  const yoy = Math.round(((fyTotal - priorFY) / priorFY) * 1000) / 10;
  const headcount = 5 + ((i * 7) % 48);
  return [name, ...quarters, fyTotal, priorFY, yoy, headcount];
});
const sumCol = (c) => dataRows.reduce((acc, row) => acc + row[c], 0);
const totalFy = sumCol(5);
const totalPrior = sumCol(6);
const totalRow = [
  'Total', sumCol(1), sumCol(2), sumCol(3), sumCol(4), totalFy, totalPrior,
  Math.round(((totalFy - totalPrior) / totalPrior) * 1000) / 10, sumCol(8),
];
const grid = [HEADER, ...dataRows, totalRow];

const sharedList = [];
const sharedIndex = new Map();
const internString = (s) => {
  if (sharedIndex.has(s)) return sharedIndex.get(s);
  const id = sharedList.length;
  sharedList.push(s);
  sharedIndex.set(s, id);
  return id;
};
const colLetter = (i) => String.fromCharCode(65 + i);
const rows = grid
  .map((row, r) => {
    const cells = row
      .map((value, c) => {
        const ref = `${colLetter(c)}${r + 1}`;
        if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
        return `<c r="${ref}" t="s"><v>${internString(value)}</v></c>`;
      })
      .join('');
    return `<row r="${r + 1}">${cells}</row>`;
  })
  .join('');
const sharedStrings = sharedList.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('');

const xlsx = new JSZip();
xlsx.file(
  '[Content_Types].xml',
  `${XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
);
xlsx.file(
  '_rels/.rels',
  `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
);
xlsx.file(
  'xl/workbook.xml',
  `${XML}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
);
xlsx.file(
  'xl/_rels/workbook.xml.rels',
  `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
);
xlsx.file(
  'xl/sharedStrings.xml',
  `${XML}
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedList.length}" uniqueCount="${sharedList.length}">
${sharedStrings}
</sst>`,
);
xlsx.file(
  'xl/worksheets/sheet1.xml',
  `${XML}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rows}</sheetData>
</worksheet>`,
);
writeFileSync(join(OUT, 'quarterly-budget.xlsx'), await xlsx.generateAsync({ type: 'nodebuffer' }));

// ---- pptx: a designed pitch deck -----------------------------------------
// A short, opinionated product deck so the inline preview shows a real story:
// title, problem, the core idea, why-it-matters, hard numbers, roadmap, close.
// Shapes are positioned in EMU (914,400 per inch) on the 10 × 7.5in canvas; a
// tiny layout DSL (rect / text / para / run) keeps each slide readable.
const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

const IN = (n) => Math.round(n * 914400); // inches → EMU
const INK = '1A1A1A';
const MUTED = '6B6B6B';
const ACCENT = 'E25C4B'; // coral, echoing the Blok house mark
const WHITE = 'FFFFFF';

// A run of text with its own size/weight/colour/letter-spacing.
const run = (text, { sz = 2000, b = false, color = INK, spc } = {}) =>
  `<a:r><a:rPr lang="en-US" sz="${sz}"${b ? ' b="1"' : ''}${spc ? ` spc="${spc}"` : ''}>`
  + `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r>`;

// A paragraph: optional accent bullet, alignment, and trailing space.
const para = (runs, { align = 'l', bullet = false, after = 600 } = {}) => {
  const bu = bullet
    ? `<a:buClr><a:srgbClr val="${ACCENT}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>`
    : '<a:buNone/>';
  const marL = bullet ? ' marL="342900" indent="-342900"' : '';
  return `<a:p><a:pPr${marL} algn="${align}"><a:spcAft><a:spcPts val="${after}"/></a:spcAft>${bu}</a:pPr>`
    + `${[].concat(runs).join('')}</a:p>`;
};

let shapeId = 1;
// A solid-fill rectangle (accent tabs, the closing slide's wash).
const rect = (x, y, w, h, color) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++shapeId}" name="Rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  + `<p:spPr><a:xfrm><a:off x="${IN(x)}" y="${IN(y)}"/><a:ext cx="${IN(w)}" cy="${IN(h)}"/></a:xfrm>`
  + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
  + `<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;

// A text box; `anchor` controls vertical alignment within the box.
const text = (x, y, w, h, paras, anchor = 't') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++shapeId}" name="Txt"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
  + `<p:spPr><a:xfrm><a:off x="${IN(x)}" y="${IN(y)}"/><a:ext cx="${IN(w)}" cy="${IN(h)}"/></a:xfrm>`
  + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
  + `<p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>`
  + `${[].concat(paras).join('')}</p:txBody></p:sp>`;

const eyebrow = (label) => text(0.7, 1.0, 8.6, 0.5, para(run(label, { sz: 1300, b: true, color: ACCENT, spc: 300 })));
const heading = (txt, sz = 4000) => text(0.7, 1.5, 8.6, 1.9, para(run(txt, { sz, b: true, color: INK })));
const bullets = (items, y = 3.3) =>
  text(0.7, y, 8.6, 3.6, items.map((t) => para(run(t, { sz: 2200, color: INK }), { bullet: true, after: 900 })));

// One metric column: a big accent number over a muted caption.
const metric = (x, value, label) =>
  text(x, 3.1, 2.7, 2.2, [
    para(run(value, { sz: 5400, b: true, color: ACCENT }), { after: 300 }),
    para(run(label, { sz: 1500, color: MUTED })),
  ]);

const slides = [
  // 1 — title
  [
    rect(0.7, 1.15, 0.6, 0.13, ACCENT),
    text(0.7, 1.5, 8.6, 1.7, para(run('Blok', { sz: 6600, b: true, color: INK }))),
    text(0.7, 3.1, 8.6, 0.9, para(run('The block-based editor for modern documents', { sz: 2600, color: MUTED }))),
    text(0.7, 6.35, 8.6, 0.5, para(run('PRODUCT OVERVIEW · 2026', { sz: 1300, b: true, color: ACCENT, spc: 300 }))),
  ],
  // 2 — the problem
  [
    eyebrow('THE PROBLEM'),
    heading('Rich text shouldn’t trap your content'),
    text(0.7, 3.5, 7.7, 1.8, para(run(
      'Most editors serialize to tangled HTML. Move that content somewhere new and the structure — and half the formatting — breaks on the way out.',
      { sz: 2200, color: MUTED },
    ))),
  ],
  // 3 — the idea
  [
    eyebrow('THE IDEA'),
    heading('Everything is a block', 4400),
    bullets([
      'A paragraph is a block',
      'A table is a block',
      'A database row is a block',
      'A page is just a block with children',
    ]),
  ],
  // 4 — why teams choose it
  [
    eyebrow('WHY TEAMS CHOOSE BLOK'),
    heading('Built for developers'),
    bullets([
      'Headless and framework-agnostic',
      'Clean, structured JSON — never HTML soup',
      'Typed plugin API for custom tools',
      'Real-time collaboration powered by Yjs',
    ]),
  ],
  // 5 — hard numbers
  [
    eyebrow('BY THE NUMBERS'),
    heading('Small core, serious range'),
    metric(0.7, '15+', 'block types out of the box'),
    metric(3.65, '100%', 'portable JSON, zero HTML'),
    metric(6.6, '0', 'frameworks you’re locked into'),
  ],
  // 6 — roadmap
  [
    eyebrow('WHAT’S NEXT'),
    heading('Roadmap'),
    bullets([
      'Inline office previews',
      'Database & kanban views',
      'Comments & suggestions',
      'AI-assisted authoring',
    ]),
  ],
  // 7 — close
  [
    rect(0, 0, 10, 7.5, ACCENT),
    rect(0.7, 2.35, 0.6, 0.13, WHITE),
    text(0.7, 2.7, 8.6, 1.4, para(run('Start building with Blok', { sz: 4600, b: true, color: WHITE }))),
    text(0.7, 4.15, 8.6, 0.7, para(run('github.com/jackuait/blok', { sz: 2200, color: WHITE }))),
  ],
];

const slideXml = (shapes) => `${XML}
<p:sld xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${shapes.join('')}
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>`;

const pptx = new JSZip();
const slideOverrides = slides
  .map(
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  )
  .join('');
pptx.file(
  '[Content_Types].xml',
  `${XML}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${slideOverrides}
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`,
);
pptx.file(
  '_rels/.rels',
  `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
);
const sldIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
pptx.file(
  'ppt/presentation.xml',
  `${XML}
<p:presentation xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${sldIds}</p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
);
const presRels = slides
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
  )
  .join('');
pptx.file(
  'ppt/_rels/presentation.xml.rels',
  `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${presRels}
<Relationship Id="rId${slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`,
);
slides.forEach((slide, i) => {
  pptx.file(`ppt/slides/slide${i + 1}.xml`, slideXml(slide));
  pptx.file(
    `ppt/slides/_rels/slide${i + 1}.xml.rels`,
    `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
  );
});
pptx.file(
  'ppt/slideLayouts/slideLayout1.xml',
  `${XML}
<p:sldLayout xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}" type="blank">
<p:cSld name="Blank"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sldLayout>`,
);
pptx.file(
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
  `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
);
const clrMap = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;
pptx.file(
  'ppt/slideMasters/slideMaster1.xml',
  `${XML}
<p:sldMaster xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
</p:spTree></p:cSld>${clrMap}
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
);
pptx.file(
  'ppt/slideMasters/_rels/slideMaster1.xml.rels',
  `${XML}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
);
const fontScheme = `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`;
const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
const clrScheme = `<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${clr('dk2', '44546A')}${clr('lt2', 'E7E6E6')}${clr('accent1', '4472C4')}${clr('accent2', 'ED7D31')}${clr('accent3', 'A5A5A5')}${clr('accent4', 'FFC000')}${clr('accent5', '5B9BD5')}${clr('accent6', '70AD47')}${clr('hlink', '0563C1')}${clr('folHlink', '954F72')}</a:clrScheme>`;
const fmtScheme = `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>`;
pptx.file(
  'ppt/theme/theme1.xml',
  `${XML}
<a:theme xmlns:a="${NS.a}" name="Office Theme"><a:themeElements>${clrScheme}${fontScheme}${fmtScheme}</a:themeElements></a:theme>`,
);
writeFileSync(join(OUT, 'pitch-deck.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }));

console.log('playground office samples written to', OUT);
