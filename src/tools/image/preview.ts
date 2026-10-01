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
    <path data-part="bird" d="M80 20q2-2 4 0q2-2 4 0M92 26q1.5-1.5 3 0q1.5-1.5 3 0M70 27q1.2-1.2 2.4 0q1.2-1.2 2.4 0"/>
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
  <path data-part="house" d="M84 76v-4h6v4ZM83.4 72l3.6-2.5 3.6 2.5ZM92 76v-3h4.5v3ZM91.5 73l2.75-2 2.75 2ZM99 76v-3.5h5V76ZM98.4 72.5l3.1-2.5 3.1 2.5Z"/>
  <path data-part="window" d="M85.2 73.2h1v1.1h-1ZM87.8 73.2h1v1.1h-1ZM93.8 74h.9v1h-.9ZM100.4 73.6h1v1.1h-1ZM102.2 73.6h1v1.1h-1Z"/>
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
  <path data-part="ripple" style="--i:0" d="M40 84.6h8M150 79.5h12M88 84h9M58 92h12"/>
  <path data-part="ripple" style="--i:1" d="M163 89h9M126 85h6M118 86.5h5M152 86h5"/>
  <path data-part="island-reflection" d="M56 78c3 2 7 3 12 3s9-1 13-3ZM75 78h2.5l-1.25 9Z"/>
  <path data-part="island" d="M56 78c3-3 7-4.5 12-4.5s9 1.5 13 4.5ZM60 76.5a2.4 2.4 0 1 1 0-.1ZM63.5 74.5a2.8 2.8 0 1 1 0-.1ZM79.5 76a2.2 2.2 0 1 1 0-.1ZM57.8 77a1.6 1.6 0 1 1 0-.1ZM81.5 77.2a1.5 1.5 0 1 1 0-.1ZM66.5 70.2 71 67.6l4.5 2.6ZM75 75.5V66h2.5v9.5ZM75 66l1.25-5 1.25 5Z"/>
  <path data-part="church" d="M67.2 70.2h7.8v4.8h-7.8Z"/>
  <path data-part="island" d="M70.4 75v-2.2a.7.7 0 0 1 1.4 0V75ZM72.9 71.5h.8v1.3h-.8Z"/>
  <path data-part="window" d="M75.9 67.2h.7v.9h-.7Z"/>
  <path data-part="boat" d="M133 83h16l-2.2 2h-11.6ZM136.6 79.6h8.8l.6 1.2h-10ZM137.4 80.8h.6V83h-.6ZM143.9 80.8h.6V83h-.6Z"/>
  <path data-part="rower" d="M151.45 77.2a.85.85 0 1 1 0-.1ZM149.9 78h1.4l.3 4.9h-2ZM151.2 79l3.6 7.4.5-.25-3.6-7.4Z"/>
  <path data-part="pier" d="M28 80.2h28v1.1H28ZM38 81.3h.8V84H38ZM46 81.3h.8V84H46ZM54 81.3h.8V84H54ZM53.9 76.6a.9.9 0 1 1 0-.1ZM52.2 77.4h1.6l.4 2.8h-2.4ZM52.6 81.3h.7v1.6h-.7ZM155.6 75.5h.8v9h-.8ZM154.6 75.5h2.8l-.6-1.6h-1.6Z"/>
  <circle data-part="glow" cx="156" cy="76.4" r="3"/>
  <path data-part="lamp" d="M155.2 75.5h1.6v1.4h-1.6Z"/>
  <path data-part="pine" d="M184 66l-3.5 6h2l-4 6h2.5l-4.5 6h15l-4.5-6h2.5l-4-6h2ZM194 70l-2.4 4.2h1.4l-2.8 4.2h1.8l-3.2 4.6h10.4l-3.2-4.6h1.8l-2.8-4.2h1.4ZM172 71l-2.6 4.5h1.5l-3 4.5h1.9l-3.4 4.5h11.2l-3.4-4.5h1.9l-3-4.5h1.5Z"/>
  <path data-part="shore" d="M0 84c20-4 38-3 54 1s28 5 40 2l-6 11H0Z"/>
  <path data-part="shore" d="M196 86c-18-5-34-4-48 0s-22 4-30 2l4 10h74Z"/>
  <path data-part="rock" d="M176 89.5c1-1.2 3-1.4 4.4-.4.6.5.2 1-.4 1h-3.6c-.4 0-.6-.3-.4-.6ZM186 91.5c.8-1 2.4-1 3.2 0 .3.4 0 .7-.4.7h-2.5c-.4 0-.5-.4-.3-.7ZM8 92c1-1.2 3-1.2 4 0 .3.4 0 .7-.4.7H8.4c-.4 0-.6-.3-.4-.7Z"/>
  <path data-part="reed" d="M20 82.6l-1-4.2M22.4 82.4l.3-5.2M25 82.2l1.3-3.8M30 81.8l-.6-3.4"/>
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
