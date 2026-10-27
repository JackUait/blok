/** Builds chart part XML for tests. */
const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

export function chartXml(plot: string, parts: { head?: string; tail?: string; txPr?: string } = {}): string {
  return `<c:chartSpace ${NS}><c:chart>${parts.head ?? ''}<c:plotArea>${plot}</c:plotArea>${parts.tail ?? ''}</c:chart>${parts.txPr ?? ''}</c:chartSpace>`;
}

function points(values: (number | string)[]): string {
  return `<c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}`;
}

export interface SerSpec {
  name?: string;
  order?: number;
  cats?: string[];
  vals: number[];
  xs?: number[];
  formatCode?: string;
  spPr?: string;
  dPt?: string;
  dLbls?: string;
  marker?: string;
  extra?: string;
}

export function ser(spec: SerSpec): string {
  const order = spec.order ?? 0;
  const tx = spec.name === undefined ? '' : `<c:tx><c:strRef><c:strCache>${points([spec.name])}</c:strCache></c:strRef></c:tx>`;
  const cat = spec.cats ? `<c:cat><c:strRef><c:strCache>${points(spec.cats)}</c:strCache></c:strRef></c:cat>` : '';
  const fc = `<c:formatCode>${spec.formatCode ?? 'General'}</c:formatCode>`;
  const data = spec.xs
    ? `<c:xVal><c:numRef><c:numCache>${fc}${points(spec.xs)}</c:numCache></c:numRef></c:xVal><c:yVal><c:numRef><c:numCache>${fc}${points(spec.vals)}</c:numCache></c:numRef></c:yVal>`
    : `${cat}<c:val><c:numRef><c:numCache>${fc}${points(spec.vals)}</c:numCache></c:numRef></c:val>`;
  const spPr = spec.spPr ? `<c:spPr>${spec.spPr}</c:spPr>` : '';

  return `<c:ser><c:idx val="${order}"/><c:order val="${order}"/>${tx}${spPr}${spec.marker ?? ''}${spec.dPt ?? ''}${spec.dLbls ?? ''}${data}${spec.extra ?? ''}</c:ser>`;
}
