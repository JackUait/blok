import { createPreview, h } from '../../components/utils/block-preview';

// Static markup only: the scene never carries user data.
const SCENE = `
<svg viewBox="0 0 196 98" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
  <path data-part="star" style="--i:0" d="M14 8h.1M92 11h.1M160 7h.1"/>
  <path data-part="star" style="--i:1" d="M38 14h.1M118 4h.1M182 15h.1"/>
  <path data-part="star" style="--i:2" d="M62 5h.1M136 12h.1M4 18h.1"/>
  <path data-part="cloud" style="--i:0" d="M140 22h20M146 26h28"/>
  <path data-part="cloud" style="--i:1" d="M28 28h24M38 32h16"/>
  <g data-part="flock">
    <g transform="translate(84 20) scale(1)">
      <g data-part="bird" style="--i:0">
        <path data-part="wing-left" d="M0 0C-1-1.8-2.6-2.4-4.6-1.8-3-1.2-1.6-.4-.2.8Z"/>
        <path data-part="wing-right" d="M0 0C1-1.8 2.6-2.4 4.6-1.8 3-1.2 1.6-.4.2.8Z"/>
        <ellipse cx="0" cy=".2" rx="1" ry=".6"/>
      </g>
    </g>
    <g transform="translate(96 26) scale(0.8)">
      <g data-part="bird" style="--i:1">
        <path data-part="wing-left" d="M0 0C-1-1.8-2.6-2.4-4.6-1.8-3-1.2-1.6-.4-.2.8Z"/>
        <path data-part="wing-right" d="M0 0C1-1.8 2.6-2.4 4.6-1.8 3-1.2 1.6-.4.2.8Z"/>
        <ellipse cx="0" cy=".2" rx="1" ry=".6"/>
      </g>
    </g>
    <g transform="translate(72 27) scale(0.65)">
      <g data-part="bird" style="--i:2">
        <path data-part="wing-left" d="M0 0C-1-1.8-2.6-2.4-4.6-1.8-3-1.2-1.6-.4-.2.8Z"/>
        <path data-part="wing-right" d="M0 0C1-1.8 2.6-2.4 4.6-1.8 3-1.2 1.6-.4.2.8Z"/>
        <ellipse cx="0" cy=".2" rx="1" ry=".6"/>
      </g>
    </g>
  </g>
  <path data-part="range-back" d="M0 50 18 38l14 6 22-16 16 10 16-7 14 22V98H0ZM196 46l-20-16-16 10-14-8-18 20V98h68Z"/>
  <path data-part="ray" d="M96.5 53.9L85.9 51M98.1 50L88.6 44.5M100.7 46.7L92.9 38.9M104 44.1L98.5 34.6M107.9 42.5L105 31.9M112 42L112 31M116.1 42.5L119 31.9M120 44.1L125.5 34.6M123.3 46.7L131.1 38.9M125.9 50L135.4 44.5M127.5 53.9L138.1 51"/>
  <circle data-part="glow" cx="112" cy="58" r="32"/>
  <circle data-part="glow" cx="112" cy="58" r="20"/>
  <circle data-part="sun" cx="112" cy="58" r="11"/>
  <path data-part="range-far" d="M0 58 12 48l10 5 18-19 12 10 10-5 16 13 12-6 10 12 12 2 12-2 16-22 12 10 10-6 16 12 12-7 6 4V98H0Z"/>
  <path data-part="range-light" d="M40 34l12 10-6 2ZM62 39l16 13H68ZM90 46l10 12h-7ZM140 36l-16 22h10ZM162 40l-10 6 6 2Z"/>
  <path data-part="snow" d="M34 40.3 40 34l5 4.2-2.6.3-1.8-1.6-1.8 2.2-1.6-1.4ZM136 41.5l4-5.5 5 4.2-2.4.2-1.6-1.8-1.8 2.4-1.8-1.6ZM158 42.4l4-2.4 4 3-1.5.2-1.3-1-1.3 1.2Z"/>
  <path data-part="range-mid" d="M0 66l18-8 14 5 20-10 22 13 16-4 18 6 22-5 20-7 20 8 16-4 10 3V98H0Z"/>
  <path data-part="forest" d="M28 76l1.5-3 1.5 3l1.5-2.4 1.5 2.4l1.2-2.4 1.2 2.4l1.5-2.4 1.5 2.4l1.7-3 1.7 3l1.2-2.4 1.2 2.4l1.5-4.2 1.5 4.2l1.2-3 1.2 3l1.2-4.2 1.2 4.2l1.2-2.4 1.2 2.4l1.2-2.4 1.2 2.4l1.7-4.2 1.7 4.2l1.2-3 1.2 3l1.2-3 1.2 3l1.5-4.2 1.5 4.2l1.2-2.4 1.2 2.4l1.7-3.6 1.7 3.6l1.7-3 1.7 3l1.2-3 1.2 3l1.5-2.4 1.5 2.4l1.7-2.4 1.7 2.4l1.7-2.4 1.7 2.4l1.7-3 1.7 3l1.5-4.2 1.5 4.2l1.5-4.2 1.5 4.2l1.7-4.2 1.7 4.2l1.5-3.6 1.5 3.6l1.2-3 1.2 3l1.7-3 1.7 3l1.2-3.6 1.2 3.6l1.7-4.2 1.7 4.2l1.5-4.2 1.5 4.2l1.5-2.4 1.5 2.4l1.2-4.2 1.2 4.2l1.2-3.6 1.2 3.6l1.2-4.2 1.2 4.2l1.5-2.4 1.5 2.4l1.7-2.4 1.7 2.4l1.7-3.6 1.7 3.6l1.5-3.6 1.5 3.6l1.7-4.2 1.7 4.2l1.7-4.2 1.7 4.2l1.2-2.4 1.2 2.4l1.5-4.2 1.5 4.2l1.7-2.4 1.7 2.4l1.2-3.6 1.2 3.6l1.7-4.2 1.7 4.2l1.5-4.2 1.5 4.2l1.7-3.6 1.7 3.6l1.2-4.2 1.2 4.2l1.5-3 1.5 3l1.7-2.4 1.7 2.4l1.5-2.4 1.5 2.4l1.2-3.6 1.2 3.6l1.2-3 1.2 3l1.5-4.2 1.5 4.2l1.5-2.4 1.5 2.4l1.2-4.2 1.2 4.2V78H28Z"/>
  <path data-part="forest" d="M91.2 73.8a1.4 1.4 0 1 1 0-.1ZM97.8 74.4a1.2 1.2 0 1 1 0-.1ZM90.9 75h.6v1h-.6ZM97.5 75.4h.6v.6h-.6Z"/>
  <path data-part="house" d="M88.6 70.6v-2.2h.8v2.2ZM102.6 71v-1.8h.7V71ZM84 76v-4h6v4ZM83.4 72l3.6-2.5 3.6 2.5ZM92 76v-3h4.5v3ZM91.5 73l2.75-2 2.75 2ZM99 76v-3.5h5V76ZM98.4 72.5l3.1-2.5 3.1 2.5Z"/>
  <path data-part="window" d="M85.2 73.2h1v1.1h-1ZM87.8 73.2h1v1.1h-1ZM93.8 74h.9v1h-.9ZM100.4 73.6h1v1.1h-1ZM102.2 73.6h1v1.1h-1ZM86.6 76v-1.4h.9V76Z"/>
  <path data-part="smoke" style="--i:0" d="M89 68q-.8-1.1 0-2.2t0-2.2"/>
  <path data-part="smoke" style="--i:1" d="M102.95 68.8q-.7-1 0-2t0-2"/>
  <g transform="translate(6 -1)">
    <path data-part="castle" d="M0 56v-8.5l1.5-1.8 1.5 1.8V56ZM3 56v-6h1.5v-1.5H6V50h1.5v-1.5H9V50h1v-6.5l2-2.5 2 2.5V56ZM11.85 41v-3.6h.3V41Z"/>
    <path data-part="flag" d="M12.15 37.4l3 .9-3 .9Z"/>
    <path data-part="window" d="M5.2 52.4h1v1.3h-1ZM11.6 45.4h.9v1.5h-.9ZM1.1 50h.8v1.1h-.8Z"/>
  </g>
  <path data-part="cliff" d="M0 78V54l11-1 3 2h9l3 4 3 8 4 11Z"/>
  <path data-part="crag" d="M20 58l2.5 4M14 61l3 6M22 66l3 7M8 60l2 5M6 68l3 6"/>
  <path data-part="lake" d="M0 76h196v22H0Z"/>
  <path data-part="range-reflection" d="M0 76L0 79.5L18 82.3L32 80.5L52 84L74 79.5L90 80.9L108 78.8L130 80.5L150 83L170 80.2L186 81.6L196 80.5V76Z"/>
  <path data-part="lake-deep" d="M0 87h196v11H0Z"/>
  <path data-part="shimmer" d="M100 79h24M103 82h18M105 85h14M107 88h10M109 91h6"/>
  <path data-part="ripple" style="--i:0" d="M40 84.6h8M88 84h9M58 92h12"/>
  <path data-part="ripple" style="--i:1" d="M163 89h9M118 86.5h5M154.5 88.6h4M155.4 89.8h2.4"/>
  <path data-part="island-reflection" d="M56 78c3 2 7 3 12 3s9-1 13-3ZM75 78h2.5l-1.25 9Z"/>
  <path data-part="island" d="M56 78c3-3 7-4.5 12-4.5s9 1.5 13 4.5ZM60 76.5a2.4 2.4 0 1 1 0-.1ZM63.5 74.5a2.8 2.8 0 1 1 0-.1ZM79.5 76a2.2 2.2 0 1 1 0-.1ZM57.8 77a1.6 1.6 0 1 1 0-.1ZM81.5 77.2a1.5 1.5 0 1 1 0-.1ZM66.5 70.2 71 67.6l4.5 2.6ZM75 75.5V66h2.5v9.5ZM75 66l1.25-5 1.25 5Z"/>
  <path data-part="church" d="M67.2 70.2h7.8v4.8h-7.8Z"/>
  <path data-part="church" d="M65.4 75v-2.8a1.8 1.8 0 0 1 1.8-1.8V75ZM78 77.2v-2.4h3.2v2.4Z"/>
  <path data-part="stair" d="M64.2 77.6h2.4v.4h-2.4ZM64.8 76.8h2.4v.4h-2.4ZM65.4 76h2.4v.4h-2.4ZM66 75.2h2.4v.4H66Z"/>
  <path data-part="island" d="M70.4 75v-2.2a.7.7 0 0 1 1.4 0V75ZM68.2 72.4a.4.4 0 0 1 .8 0v1.2h-.8ZM72.9 72.4a.4.4 0 0 1 .8 0v1.2h-.8ZM77.6 74.8l2-1.4 2 1.4ZM76.1 59.4h.3v1.7h-.3ZM75.7 59.9h1.1v.3h-1.1ZM63.3 73.6a.9 2.6 0 1 0 1.8 0a.9 2.6 0 1 0-1.8 0ZM56.8 78.2c.6-.7 1.5-.7 2.1 0ZM79.8 78.2c.5-.5 1.2-.5 1.7 0ZM82 78.6h3.6l-.7.8h-2.3Z"/>
  <path data-part="window" d="M75.9 69.6h.7v.9h-.7ZM75.6 67.2h.45v1.2h-.45ZM76.45 67.2h.45v1.2h-.45ZM79.2 75.6h.8v.8h-.8Z"/>
  <path data-part="window-reflection" d="M85.7 77.6v1.4M88.3 77.6v1.1M101 77.6v1.4M102.7 77.6v1M70 79.2h3.6M79.6 78.8v.9"/>
  <path data-part="boat-reflection" d="M133.6 85.8h15.6l-.6.6h-14.4ZM135.2 87h12.4l-.6.5h-11.2ZM137.4 88.2h8l-.5.4h-7ZM124.2 84.9h5.2l-.8.8h-3.6ZM37.6 84h.8v2h-.8ZM45.6 84h.8v2h-.8ZM53.6 84h.8v2h-.8Z"/>
  <g data-part="swan">
    <path d="M123.8 84.6C124 83.2 125.6 82.6 127.4 82.8 128.6 82.9 129.4 82.4 130.2 81.6 130.2 83 129.8 84.2 128.8 84.6Z"/>
    <path data-part="swan-wing" d="M125.6 83.5c1-.7 2.4-.8 3.6-.3-.6.8-1.8 1-3.6.3Z"/>
    <path data-part="swan-neck" d="M124.9 83.2C123.9 82.4 123.6 81.2 124.1 80.2S124.9 78.9 124.5 78.7"/>
    <ellipse cx="124.4" cy="78.8" rx=".6" ry=".5"/>
    <path data-part="beak" d="M123.9 78.6l-1 .35.95.3Z"/>
  </g>
  <g data-part="boat">
    <path d="M130.6 82.6 132.2 83.6H148.6L151.6 82.2 150.4 84.6Q150 85.4 149 85.4H134Q133 85.4 132.4 84.8ZM134.9 80.4h.4v3.2h-.4ZM138.9 80.4h.4v3.2h-.4ZM142.9 80.4h.4v3.2h-.4ZM146.7 80.4h.4v3.2h-.4Z"/>
    <path data-part="boat-trim" d="M132.6 84.2H149.6l-.25.5H133.1Z"/>
    <path data-part="passenger" d="M136.2 83.6c0-1 .4-1.5.9-1.5s.9.5.9 1.5ZM137.1 81.8a.65.65 0 1 1 0-.1ZM140.2 83.6c0-1 .4-1.6.9-1.6s.9.6.9 1.6ZM141.1 81.6a.7.7 0 1 1 0-.1ZM144.2 83.6c0-.9.4-1.4.9-1.4s.9.5.9 1.4ZM145.1 81.9a.6.6 0 1 1 0-.1Z"/>
    <path data-part="canopy" d="M134.2 80Q141 78.2 147.8 80V80.6H134.2ZM134.2 80.6a.85.6 0 0 0 1.7 0a.85.6 0 0 0 1.7 0a.85.6 0 0 0 1.7 0a.85.6 0 0 0 1.7 0a.85.6 0 0 0 1.7 0a.85.6 0 0 0 1.7 0a.85.6 0 0 0 1.7 0a.85.6 0 0 0 1.7 0Z"/>
    <path data-part="canopy-stripe" d="M135.9 79.61L137.6 79.33V80.6a.85.6 0 0 1-1.7 0ZM139.3 79.16L141 79.1V80.6a.85.6 0 0 1-1.7 0ZM142.7 79.16L144.4 79.33V80.6a.85.6 0 0 1-1.7 0ZM146.1 79.61L147.8 80V80.6a.85.6 0 0 1-1.7 0Z"/>
    <path data-part="rower" d="M150.3 76.9a.7.7 0 1 1 0-.1ZM148.7 76.2h1.8v.3h-1.8ZM149.1 76.2v-.8h1v.8ZM148.9 77.7h1.4l.2 3h-1.7ZM148.9 80.7h.55v2.9h-.55ZM149.75 80.7h.55v2.9h-.55ZM149.9 78l.5.1-.3 2.1-.5-.1ZM148.1 78.6l7 8.6.45-.35-7-8.6ZM154.6 86.4l1.2 1.6.9-.7-1.2-1.5Z"/>
  </g>
  <path data-part="pier-deck" d="M28 80.2h28v1.1H28Z"/>
  <path data-part="pier-plank" d="M30 80.2v1.1M32 80.2v1.1M34 80.2v1.1M36 80.2v1.1M38 80.2v1.1M40 80.2v1.1M42 80.2v1.1M44 80.2v1.1M46 80.2v1.1M48 80.2v1.1M50 80.2v1.1M52 80.2v1.1M54 80.2v1.1"/>
  <path data-part="ripple" style="--i:1" d="M54.6 83.8h3"/>
  <path data-part="pier" d="M37.6 81.3h.8V84h-.8ZM45.6 81.3h.8V84h-.8ZM53.6 81.3h.8V84h-.8ZM54.15 76.8a.75.75 0 1 1 0-.1ZM52.6 77.7h1.5l.2 2.5h-1.9ZM53.6 79.4h2.6v.8h-2.6ZM55.6 80.2h.7v2.6h-.7ZM55.6 82.6h1.3v.5h-1.3ZM52.5 78l-.9 2.2.4.15.9-2.2ZM159.8 87.8h2.4l-.4-1.2h-1.6ZM160.6 77.4h.8v9.2h-.8ZM159.4 74.4h3.2l-1.6-1.6ZM160.8 72.2h.4v.8h-.4ZM159.8 74.4h.3V77h-.3ZM161.9 74.4h.3V77h-.3ZM159.6 77h2.8v.5h-2.8Z"/>
  <circle data-part="glow" cx="161" cy="75.7" r="3.6"/>
  <path data-part="lamp" d="M160.1 74.4h1.8V77h-1.8Z"/>
  <path data-part="pine" d="M183.3 83h1.4v9h-1.4ZM193.4 82h1.2v9h-1.2ZM171.4 83.5h1.2v8h-1.2ZM184 66l-3.5 6h2l-4 6h2.5l-4.5 6h15l-4.5-6h2.5l-4-6h2ZM194 70l-2.4 4.2h1.4l-2.8 4.2h1.8l-3.2 4.6h10.4l-3.2-4.6h1.8l-2.8-4.2h1.4ZM172 71l-2.6 4.5h1.5l-3 4.5h1.9l-3.4 4.5h11.2l-3.4-4.5h1.9l-3-4.5h1.5Z"/>
  <path data-part="shore" d="M0 84c20-4 38-3 54 1s28 5 40 2l-6 11H0Z"/>
  <path data-part="shore" d="M196 80c-12-1-20 2-26 5s-16 4-30 5l4 8h52Z"/>
  <path data-part="rock" d="M176 89.5c1-1.2 3-1.4 4.4-.4.6.5.2 1-.4 1h-3.6c-.4 0-.6-.3-.4-.6ZM186 91.5c.8-1 2.4-1 3.2 0 .3.4 0 .7-.4.7h-2.5c-.4 0-.5-.4-.3-.7ZM8 92c1-1.2 3-1.2 4 0 .3.4 0 .7-.4.7H8.4c-.4 0-.6-.3-.4-.7Z"/>
  <path data-part="reed" d="M19.6 82.6q-.4-2.6-1.2-5M22.2 82.4q.2-3 .2-5.6M24.8 82.2q.8-2 1.6-3.8M28 82q-.2-2-.8-3.4M30 81.8q.4-1.6 1.2-2.8M21 82.6q-.6-1.6-1.8-2.8M26 82.2q.6-1.4 1.8-2.4"/>
  <path data-part="cattail" d="M17.95 76.2a.45.45 0 0 1 .9 0v1.8a.45.45 0 0 1-.9 0ZM21.95 75.4a.45.45 0 0 1 .9 0v1.8a.45.45 0 0 1-.9 0ZM25.95 76.8a.45.45 0 0 1 .9 0v1.8a.45.45 0 0 1-.9 0Z"/>
  <path data-part="flower" d="M6 87h.1M12 89.5h.1M17 86.6h.1M26 88h.1M33 90.5h.1M42 87.4h.1M160 92h.1M168 90h.1M182 94h.1M190 89.6h.1"/>
</svg>`;

/** A photo of sunset over Lake Bled, with a caption line under it. */
export const renderImagePreview = (): HTMLElement => {
  const scene = h('div', { 'data-part': 'scene' });

  scene.innerHTML = SCENE;

  return createPreview(
    'image',
    h('div', { 'data-part': 'photo' }, scene),
    h('div', { 'data-part': 'caption' }, 'Golden hour at Lake Bled')
  );
};
