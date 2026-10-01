import { createPreview, h } from '../../components/utils/block-preview';

// Static markup only: the scene never carries user data.
const SCENE = `
<svg viewBox="0 0 196 98" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
  <path data-part="star" d="M14 8h.1M38 14h.1M62 5h.1M92 11h.1M118 4h.1M160 7h.1M182 15h.1"/>
  <path data-part="cloud" d="M140 22h20M146 26h28M28 28h24M38 32h16"/>
  <path data-part="bird" d="M80 20q2-2 4 0q2-2 4 0M92 26q1.5-1.5 3 0q1.5-1.5 3 0"/>
  <path data-part="range-back" d="M0 50 18 38l14 6 22-16 16 10 16-7 14 22V98H0ZM196 46l-20-16-16 10-14-8-18 20V98h68Z"/>
  <circle data-part="glow" cx="112" cy="58" r="32"/>
  <circle data-part="glow" cx="112" cy="58" r="20"/>
  <circle data-part="sun" cx="112" cy="58" r="11"/>
  <path data-part="range-far" d="M0 58 12 48l10 5 18-19 12 10 10-5 16 13 12-6 10 12 12 2 12-2 16-22 12 10 10-6 16 12 12-7 6 4V98H0Z"/>
  <path data-part="snow" d="M34 40.3 40 34l5 4.2-2.6.3-1.8-1.6-1.8 2.2-1.6-1.4ZM136 41.5l4-5.5 5 4.2-2.4.2-1.6-1.8-1.8 2.4-1.8-1.6ZM158 42.4l4-2.4 4 3-1.5.2-1.3-1-1.3 1.2Z"/>
  <path data-part="range-mid" d="M0 66l18-8 14 5 20-10 22 13 16-4 18 6 22-5 20-7 20 8 16-4 10 3V98H0Z"/>
  <g transform="translate(6 -1)">
    <path data-part="castle" d="M3 56v-6h1.5v-1.5H6V50h1.5v-1.5H9V50h1v-6.5l2-2.5 2 2.5V56Z"/>
    <path data-part="window" d="M5.2 52.4h1v1.3h-1ZM11.6 45.4h.9v1.5h-.9Z"/>
  </g>
  <path data-part="cliff" d="M0 78V54l11-1 3 2h9l3 4 3 8 4 11Z"/>
  <path data-part="lake" d="M0 76h196v22H0Z"/>
  <path data-part="lake-deep" d="M0 87h196v11H0Z"/>
  <path data-part="shimmer" d="M100 79h24M103 82h18M105 85h14M107 88h10M109 91h6"/>
  <path data-part="ripple" d="M36 81h8M150 79.5h12M88 84h9M163 89h9M58 92h12M126 85h6M152 86h5"/>
  <path data-part="island-reflection" d="M56 78c3 2 7 3 12 3s9-1 13-3ZM75 78h2.5l-1.25 9Z"/>
  <path data-part="island" d="M56 78c3-3 7-4.5 12-4.5s9 1.5 13 4.5ZM60 76.5a2.4 2.4 0 1 1 0-.1ZM63.5 74.5a2.8 2.8 0 1 1 0-.1ZM79.5 76a2.2 2.2 0 1 1 0-.1ZM66.5 70.2 71 67.6l4.5 2.6ZM75 75.5V66h2.5v9.5ZM75 66l1.25-5 1.25 5Z"/>
  <path data-part="church" d="M67.2 70.2h7.8v4.8h-7.8Z"/>
  <path data-part="boat" d="M133 83h16l-2.2 2h-11.6ZM136.6 79.6h8.8l.6 1.2h-10ZM137.4 80.8h.6V83h-.6ZM143.9 80.8h.6V83h-.6Z"/>
  <path data-part="pine" d="M184 66l-3.5 6h2l-4 6h2.5l-4.5 6h15l-4.5-6h2.5l-4-6h2ZM194 70l-2.4 4.2h1.4l-2.8 4.2h1.8l-3.2 4.6h10.4l-3.2-4.6h1.8l-2.8-4.2h1.4ZM172 71l-2.6 4.5h1.5l-3 4.5h1.9l-3.4 4.5h11.2l-3.4-4.5h1.9l-3-4.5h1.5Z"/>
  <path data-part="shore" d="M0 84c20-4 38-3 54 1s28 5 40 2l-6 11H0Z"/>
  <path data-part="shore" d="M196 86c-18-5-34-4-48 0s-22 4-30 2l4 10h74Z"/>
  <path data-part="reed" d="M20 82.6l-1-4.2M22.4 82.4l.3-5.2M25 82.2l1.3-3.8M30 81.8l-.6-3.4"/>
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
