import { createPreview, h } from '../../components/utils/block-preview';

// Static markup only: the scene never carries user data.
const SCENE = `
<svg viewBox="0 0 196 98" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
  <circle data-part="glow" cx="126" cy="60" r="30"/>
  <circle data-part="sun" cx="126" cy="60" r="13"/>
  <path data-part="range-far" d="M0 62 22 46l16 9 22-20 20 16 14-8 26 22 20-14 24 12 20-10 12 7V98H0Z"/>
  <path data-part="range-mid" d="M0 70l26-10 20 8 24-14 30 18 22-9 26 11 22-7 26 9V98H0Z"/>
  <path data-part="lake" d="M0 78h196v20H0Z"/>
  <path data-part="shimmer" d="M112 82h28M118 86h16M121 90h10"/>
  <path data-part="shore" d="M0 84c20-4 38-3 54 1s28 5 40 2l-6 11H0Z"/>
  <path data-part="shore" d="M196 86c-18-5-34-4-48 0s-22 4-30 2l4 10h74Z"/>
</svg>`;

/** A photo of a sunset over a lake, with a caption line under it. */
export const renderImagePreview = (): HTMLElement => {
  const scene = h('div', { 'data-part': 'scene' });

  scene.innerHTML = SCENE;

  return createPreview(
    'image',
    h('div', { 'data-part': 'photo' }, scene),
    h('div', { 'data-part': 'caption' }, 'Golden hour at Lake Bled')
  );
};
