import JSZip from 'jszip';

const NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

/** A 1×1 PNG. */
export const PIXEL_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
), (c) => c.charCodeAt(0));

export interface DeckSlide {
  /** Text of one text box. */
  text: string;
  /** Embed one picture from `ppt/media/`. */
  picture?: boolean;
  /** Turn the text into a link with this relationship target. */
  link?: { target: string; external: boolean };
  /** Make the whole text box a link to this external target. */
  shapeLink?: string;
}

const textBox = (slide: DeckSlide): string => {
  const jump = slide.link?.external === false ? ' action="ppaction://hlinksldjump"' : '';
  const click = slide.link === undefined ? '' : `<a:hlinkClick r:id="rIdLink"${jump}/>`;

  const shapeClick = slide.shapeLink === undefined ? '' : '<a:hlinkClick r:id="rIdShapeLink"/>';

  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text">${shapeClick}</p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + '<p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="4572000" cy="914400"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="2400">${click}</a:rPr><a:t>${slide.text}</a:t></a:r></a:p></p:txBody></p:sp>`;
};

const picture = '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
  + '<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
  + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>'
  + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';

const slideRels = (slide: DeckSlide): string => {
  const rels = [`<Relationship Id="rIdLayout" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];

  if (slide.picture === true) {
    rels.push(`<Relationship Id="rIdImage" Type="${REL}/image" Target="../media/image1.png"/>`);
  }
  if (slide.link !== undefined) {
    const mode = slide.link.external ? ' TargetMode="External"' : '';
    const type = slide.link.external ? 'hyperlink' : 'slide';

    rels.push(`<Relationship Id="rIdLink" Type="${REL}/${type}" Target="${slide.link.target}"${mode}/>`);
  }

  if (slide.shapeLink !== undefined) {
    rels.push(`<Relationship Id="rIdShapeLink" Type="${REL}/hyperlink" Target="${slide.shapeLink}" TargetMode="External"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
};

/** Builds a minimal, DEFLATE-compressed .pptx (10in × 7.5in) with one text box per slide. */
export const buildDeck = async (slides: DeckSlide[]): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  const ids = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdSlide${i + 1}"/>`).join('');
  const presRels = slides.map((_, i) => `<Relationship Id="rIdSlide${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('');

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>');
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}>`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>'
    + `<p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rIdMaster" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
    + `<Relationship Id="rIdTheme" Type="${REL}/theme" Target="theme/theme1.xml"/>${presRels}</Relationships>`);
  slides.forEach((slide, i) => {
    const body = textBox(slide) + (slide.picture === true ? picture : '');

    zip.file(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree>${EMPTY_TREE}${body}</p:spTree></p:cSld></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels(slide));
  });
  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS}><p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${NS}><p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>`
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>');
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
    + `<Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/theme/theme1.xml', '<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements>'
    + '<a:clrScheme name="C"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>'
    + '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3>'
    + '<a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>'
    + '<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>'
    + '<a:fontScheme name="F"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>'
    + '<a:fmtScheme name="S"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>');
  if (slides.some((slide) => slide.picture === true)) {
    zip.file('ppt/media/image1.png', PIXEL_PNG);
  }

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
};
