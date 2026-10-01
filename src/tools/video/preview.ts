import { createPreview, h } from '../../components/utils/block-preview';
import { IconExpandFullscreen, IconPlayerPause, IconPlayerPlay, IconPlayerVolume } from '../../components/icons';

const glyph = (part: string, svg: string): HTMLElement => {
  const el = h('span', { 'data-part': part, 'aria-hidden': 'true' });

  el.innerHTML = svg;

  return el;
};

// Static markup only. Ground layers run 30-44 units past both edges so the pan never shows their ends.
// Figures sit in an outer <g transform>: a CSS transform on the same element would replace it.
const SCENE = `
<svg data-part="camera" viewBox="0 0 196 110" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
  <path data-part="milky-way" d="M-10 58C40 34 96 18 210-8"/>
  <path data-part="milky-way" style="--w:18" d="M-10 58C40 34 96 18 210-8"/>
  <path data-part="milky-core" d="M-10 58C40 34 96 18 210-8"/>
  <path data-part="star" style="--i:0;--s:1.2" d="M64.2 8.6h.1M15.4 6h.1M112.8 19.5h.1M124.7 18.4h.1M89 15.2h.1M170.1 15.8h.1M6.3 22.3h.1M185 32.4h.1M21.9 29.9h.1M6.9 40.5h.1M34.1 36h.1"/>
  <path data-part="star" style="--i:1;--s:.9" d="M127 5.2h.1M83.5 38.4h.1M189.4 4h.1M107.2 4.8h.1M48.9 27.3h.1M163.3 43.6h.1M34.3 7.2h.1M101 29.2h.1M42.1 9.1h.1M119.9 8.5h.1M7.4 14.3h.1"/>
  <path data-part="star" style="--i:2;--s:.7" d="M104.9 18.1h.1M25.8 11.8h.1M61.2 37.9h.1M132.6 20.8h.1M102.8 40.5h.1M93 31.2h.1M55.5 20.3h.1M174.7 36.3h.1M2 8.7h.1M71.9 7.4h.1M185.7 21.7h.1"/>
  <path data-part="star" style="--i:3;--s:.55" d="M13.1 24.3h.1M122.5 43.7h.1M36.7 27.6h.1M62.3 27.8h.1M9.5 31.4h.1M76.1 31.4h.1M70.9 40.9h.1M77.3 19.6h.1M21.5 18h.1M91.5 23.3h.1M181.9 45.5h.1"/>
  <path data-part="sparkle" style="--i:0" d="M30 16l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z"/>
  <path data-part="sparkle" style="--i:1" d="M98 9l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4Z"/>
  <path data-part="sparkle" style="--i:2" d="M180 8l.45 1.35 1.35.45-1.35.45-.45 1.35-.45-1.35-1.35-.45 1.35-.45Z"/>
  <g data-part="meteor" style="--i:0">
    <path data-part="meteor-tail" d="M84 6 64 16"/>
    <path data-part="meteor-head" d="M70 13 64 16"/>
  </g>
  <g data-part="meteor" style="--i:1">
    <path data-part="meteor-tail" d="M150 4 134 11"/>
    <path data-part="meteor-head" d="M139 8.8 134 11"/>
  </g>
  <g data-part="moon">
    <circle data-part="halo" cx="152" cy="26" r="26"/>
    <circle data-part="halo" cx="152" cy="26" r="20"/>
    <circle data-part="halo" cx="152" cy="26" r="15"/>
    <circle data-part="halo" cx="152" cy="26" r="11.5"/>
    <circle data-part="moon-disc" cx="152" cy="26" r="8.5"/>
    <circle data-part="crater" cx="149" cy="24" r="1.6"/>
    <circle data-part="crater" cx="155.2" cy="29" r="1.1"/>
    <circle data-part="crater" cx="154.4" cy="22" r=".8"/>
    <circle data-part="crater" cx="148.6" cy="29.6" r=".7"/>
  </g>
  <path data-part="cloud" style="--i:0" d="M128 33h20M136 36.5h30M150 40h14"/>
  <path data-part="cloud" style="--i:1" d="M30 30h26M40 33.5h18"/>
  <g transform="translate(152 26)">
    <g data-part="bat" style="--i:0">
      <g transform="translate(0 -2)"><path data-part="bat-wing" d="M0 0C-1.5-1.6-3-1.8-4.2-.6-3.4-.4-3 0-2.8.6-2 .2-1 .3 0 1 1 .3 2 .2 2.8.6 3 0 3.4-.4 4.2-.6 3-1.8 1.5-1.6 0 0Z"/></g>
    </g>
    <g data-part="bat" style="--i:1">
      <g transform="translate(9 3) scale(.7)"><path data-part="bat-wing" d="M0 0C-1.5-1.6-3-1.8-4.2-.6-3.4-.4-3 0-2.8.6-2 .2-1 .3 0 1 1 .3 2 .2 2.8.6 3 0 3.4-.4 4.2-.6 3-1.8 1.5-1.6 0 0Z"/></g>
    </g>
  </g>
  <g data-part="layer-far">
    <path data-part="mesa" d="M-30 70V54H-18L-16 46H-4L-2 50H6L8 44H22L25 54H40L44 58H96L99 50H104L106 42H118L120 50H124L126 56H170L172 48H180L182 40H196L199 48H208L210 55H226V70Z"/>
    <path data-part="mesa-strata" d="M9 47.5H21M8.4 51H23.4M107 45.5H117.4M106.6 49H119M183 43.5H195.6M182.4 47H198"/>
    <path data-part="mesa-rim" d="M-16 46H-4M8 44H22M106 42H118M182 40H196M22 44 25 54M118 42 120 50"/>
  </g>
  <g data-part="layer-mid">
    <path data-part="dune-far" d="M-40 60C-10 57 10 56 40 56.5S90 57.5 120 57 180 56 240 57V84H-40Z"/>
    <path data-part="ridge" d="M-40 60C-10 57 10 56 40 56.5S90 57.5 120 57 180 56 240 57"/>
    <path data-part="ripple" d="M8 61q6-1 12 0M46 62.5q8-1.2 16 0M98 61.5q7-1 14 0M150 62q6-1 12 0M26 65q9-1.2 18 0M120 65.5q8-1 16 0"/>
    <g transform="translate(0 57)">
      <g data-part="caravan">
        <path data-part="leg" data-far="" d="M-2.3-3.1l-.25 1.6.25 1.5"/>
          <path data-part="leg" data-far="" data-lag="" d="M3.4-3.1l.25 1.6-.25 1.5"/>
          <path data-part="camel" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2 2.2-5.4 2.8-5 3.4-4.8 4-5.6 4.3-7.2 4.8-8 5-8.6 5.4-8.8 5.7-8.6L5.9-9.1 6.1-8.5C6.6-8.4 7-8 7.3-7.5L7.1-7.2 6.2-7.2C5.6-6.6 5.4-5 4.6-3.8 4.2-3.1 3.4-2.8 2.6-2.8H-3.4C-4.2-2.9-4.6-3.4-4.5-4.2Z"/>
          <path data-part="camel-line" d="M-4.4-4.1Q-5.3-3.6-5.1-2.3"/>
          <path data-part="rim" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2M4.8-8C5-8.6 5.4-8.8 5.7-8.6"/>
          <path data-part="saddle" d="M-2.1-6.1C-1.4-7.2.6-7.3 1.4-6.1L1.1-4.8H-1.8Z"/>
          <path data-part="saddle-stripe" d="M-1.9-5.4H1.2"/>
          <path data-part="leg" data-lag="" d="M-3.2-3.1l-.25 1.6.25 1.5"/>
          <path data-part="leg" d="M2.5-3.1l.25 1.6-.25 1.5"/>
        <path data-part="rider" d="M-1.2-7.4C-1.1-8.6-.7-9.6.1-9.8.9-9.6 1.2-8.6 1.3-7.4ZM.1-10.3a.8.8 0 1 0 .1 0Z"/>
        <g transform="translate(-.4 -10.6)"><path data-part="scarf" d="M0 0C-.8.2-1.6.8-2.2 1.4-1.4 1.2-.8 1-.2.7Z"/></g>
        <path data-part="camel-line" d="M.9-8.8 2.6-10.2"/>
        <circle data-part="lantern-glow" cx="2.8" cy="-9.6" r="2.2"/>
        <circle data-part="lantern-glow" cx="2.8" cy="-9.6" r="1.2"/>
        <circle data-part="lantern" cx="2.8" cy="-9.6" r=".55"/>
        <g transform="translate(-11 0)">
          <path data-part="leg" data-far="" d="M-2.3-3.1l-.25 1.6.25 1.5"/>
          <path data-part="leg" data-far="" data-lag="" d="M3.4-3.1l.25 1.6-.25 1.5"/>
          <path data-part="camel" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2 2.2-5.4 2.8-5 3.4-4.8 4-5.6 4.3-7.2 4.8-8 5-8.6 5.4-8.8 5.7-8.6L5.9-9.1 6.1-8.5C6.6-8.4 7-8 7.3-7.5L7.1-7.2 6.2-7.2C5.6-6.6 5.4-5 4.6-3.8 4.2-3.1 3.4-2.8 2.6-2.8H-3.4C-4.2-2.9-4.6-3.4-4.5-4.2Z"/>
          <path data-part="camel-line" d="M-4.4-4.1Q-5.3-3.6-5.1-2.3"/>
          <path data-part="rim" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2M4.8-8C5-8.6 5.4-8.8 5.7-8.6"/>
          <path data-part="saddle" d="M-2.1-6.1C-1.4-7.2.6-7.3 1.4-6.1L1.1-4.8H-1.8Z"/>
          <path data-part="saddle-stripe" d="M-1.9-5.4H1.2"/>
          <path data-part="leg" data-lag="" d="M-3.2-3.1l-.25 1.6.25 1.5"/>
          <path data-part="leg" d="M2.5-3.1l.25 1.6-.25 1.5"/>
          <path data-part="pack" d="M-2.6-7.6h3.6l-.3 1.6h-3Z"/>
        </g>
        <g transform="translate(-22 0)">
          <path data-part="leg" data-far="" d="M-2.3-3.1l-.25 1.6.25 1.5"/>
          <path data-part="leg" data-far="" data-lag="" d="M3.4-3.1l.25 1.6-.25 1.5"/>
          <path data-part="camel" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2 2.2-5.4 2.8-5 3.4-4.8 4-5.6 4.3-7.2 4.8-8 5-8.6 5.4-8.8 5.7-8.6L5.9-9.1 6.1-8.5C6.6-8.4 7-8 7.3-7.5L7.1-7.2 6.2-7.2C5.6-6.6 5.4-5 4.6-3.8 4.2-3.1 3.4-2.8 2.6-2.8H-3.4C-4.2-2.9-4.6-3.4-4.5-4.2Z"/>
          <path data-part="camel-line" d="M-4.4-4.1Q-5.3-3.6-5.1-2.3"/>
          <path data-part="rim" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2M4.8-8C5-8.6 5.4-8.8 5.7-8.6"/>
          <path data-part="saddle" d="M-2.1-6.1C-1.4-7.2.6-7.3 1.4-6.1L1.1-4.8H-1.8Z"/>
          <path data-part="saddle-stripe" d="M-1.9-5.4H1.2"/>
          <path data-part="leg" data-lag="" d="M-3.2-3.1l-.25 1.6.25 1.5"/>
          <path data-part="leg" d="M2.5-3.1l.25 1.6-.25 1.5"/>
          <path data-part="pack" d="M-2.4-7.4h3.2l-.3 1.4h-2.6Z"/>
        </g>
      </g>
    </g>
  </g>
  <g data-part="layer-near">
    <path data-part="dune" d="M-40 70C-10 64 20 62.5 50 64.5S100 68 128 64 190 61 240 64V110H-40Z"/>
    <path data-part="ridge" d="M-40 70C-10 64 20 62.5 50 64.5S100 68 128 64 190 61 240 64"/>
    <g transform="translate(46 65)">
      <ellipse data-part="fire-glow" cx="0" cy=".3" rx="15" ry="3"/>
      <ellipse data-part="fire-glow" cx="0" cy=".3" rx="9.5" ry="2"/>
      <ellipse data-part="fire-glow" cx="0" cy=".3" rx="5" ry="1.2"/>
      <circle data-part="fire-glow" cx="0" cy="-2.6" r="12"/>
      <circle data-part="fire-glow" cx="0" cy="-2.6" r="8"/>
      <circle data-part="fire-glow" cx="0" cy="-2.6" r="5"/>
      <circle data-part="fire-glow" cx="0" cy="-2.6" r="3"/>
    </g>
    <g transform="translate(26 65)">
      <path data-part="guy-rope" d="M2.4-5.6-2.6 0M10.6-4.8 15.6 0M-2.6 0v-.7M15.6 0v-.7"/>
      <ellipse data-part="tent-spill" cx="6.6" cy=".3" rx="4.2" ry=".8"/>
      <path data-part="tent" d="M0 0 5-8.5 6.5 0Z"/>
      <path data-part="tent-lit" d="M6.5 0 5-8.5 13 0Z"/>
      <path data-part="tent-door" d="M4.6 0 5.6-4.4 7.8 0Z"/>
      <path data-part="tent-glow" d="M5.4 0 5.8-2.4 7 0Z"/>
      <path data-part="tent-flap" d="M5.6-4.4 7.8 0 9-.4Z"/>
      <path data-part="tent-pole" d="M5-8.5l-.9-1.6M5-8.5l1-1.5"/>
    </g>
    <g transform="translate(53 65)">
      <ellipse data-part="sitter-shadow" cx="5" cy=".25" rx="4" ry=".5"/>
      <path data-part="log" d="M-2.4.1H3.6"/>
      <path data-part="sitter" d="M2.4-.2C2.6-1.8 2.4-3.1 1.8-3.9 1.3-4.4.6-4.4.2-3.9L-.6-2.5C-1-2.3-1.5-2.1-1.6-1.5L-1.8-.2ZM1.1-5.7a.85.85 0 1 0 .1 0Z"/>
      <path data-part="fire-rim" d="M.2-3.9-.6-2.5C-1-2.3-1.5-2.1-1.6-1.5M.4-5.4Q.2-5 .3-4.6"/>
    </g>
    <g transform="translate(46 65)">
      <path data-part="stone" d="M-4 .3a.8.5 0 1 0 1.6 0 .8.5 0 1 0-1.6 0ZM-2.4.7a.7.45 0 1 0 1.4 0 .7.45 0 1 0-1.4 0ZM1 .7a.7.45 0 1 0 1.4 0 .7.45 0 1 0-1.4 0ZM2.4.3a.8.5 0 1 0 1.6 0 .8.5 0 1 0-1.6 0Z"/>
      <path data-part="log" d="M-2.6-.2 2.2-1.3M-2.2-1.3 2.6-.2"/>
      <path data-part="log-end" d="M-2.6-.2h.1M2.6-.2h.1"/>
      <path data-part="flame" d="M-.6.1C-2.3-1-2.1-3-1.2-4.4-1-3.2-.3-2.8-.1-3.6.2-5 .8-6.4 1.7-7.4 1.4-5.6 2.6-4.4 2.2-2.4 2-.9 1-.1-.6.1Z"/>
      <path data-part="flame-mid" d="M-.3 0C-1.5-.8-1.4-2.3-.7-3.3-.5-2.4 0-2.2.1-2.8.4-3.8.8-4.6 1.3-5.2 1.2-3.9 1.9-3 1.6-1.6 1.4-.6.8-.1-.3 0Z"/>
      <path data-part="flame-core" d="M.2-.1C-.6-.6-.5-1.6.1-2.6.3-1.9.8-1.6.8-1 .8-.4.6-.1.2-.1Z"/>
      <circle data-part="ember" style="--i:0;--x:-3px" cx="0" cy="-5" r=".4"/>
      <circle data-part="ember" style="--i:1;--x:2px" cx=".5" cy="-5.5" r=".3"/>
      <circle data-part="ember" style="--i:2;--x:-1px" cx="-.4" cy="-4.5" r=".35"/>
      <circle data-part="ember" style="--i:3;--x:3px" cx=".2" cy="-5" r=".25"/>
      <circle data-part="ember" style="--i:4;--x:-2px" cx=".8" cy="-4.8" r=".3"/>
      <circle data-part="ember" style="--i:5;--x:1px" cx="-.2" cy="-5.2" r=".25"/>
      <circle data-part="puff" style="--i:0" cx=".4" cy="-8" r="1.2"/>
      <circle data-part="puff" style="--i:1" cx=".4" cy="-8" r="1.2"/>
      <circle data-part="puff" style="--i:2" cx=".4" cy="-8" r="1.2"/>
    </g>
    <ellipse data-part="pond-bank" cx="150" cy="67.2" rx="20" ry="3.8"/>
    <ellipse data-part="pond" cx="150" cy="67.2" rx="17" ry="2.8"/>
    <path data-part="pond-sky" d="M135 66.2Q150 63.9 165 66.2"/>
    <path data-part="reflection" style="--i:0" d="M149.6 65.5h5"/>
    <path data-part="reflection" style="--i:1" d="M150.6 66.3h3"/>
    <path data-part="reflection" style="--i:2" d="M149 67.1h6.2"/>
    <path data-part="reflection" style="--i:3" d="M150.9 67.9h2.4"/>
    <path data-part="reflection" style="--i:4" d="M150.2 68.7h3.8"/>
    <path data-part="glint" style="--i:0" d="M140 67.4h1.4"/>
    <path data-part="glint" style="--i:1" d="M160.4 66.6h1.2"/>
    <path data-part="glint" style="--i:2" d="M144.6 68.6h.9"/>
    <g transform="translate(128 65)"><path data-part="trunk" d="M-.9 0C-1.2-6-.4-11 1-16.2L2-16C.8-11 .2-6 .9 0Z"/>
          <path data-part="trunk-ring" d="M-1-2.6H.9M-.95-5.3H.75M-.8-8H.65M-.5-10.7H.75M-.1-13.4H1.1"/>
          <path data-part="trunk-rim" d="M.9 0C.2-6 .8-11 2-16"/>
          <g transform="translate(1.5 -16)">
            <g data-part="crown">
              <path data-part="frond" transform="rotate(-14)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(18)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(44) scale(.8)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(-18)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(14)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(42) scale(.8)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(-58) scale(.62)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(-60) scale(.6)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <circle data-part="coconut" cx="-.5" cy=".7" r=".55"/>
              <circle data-part="coconut" cx=".5" cy=".9" r=".55"/>
              <circle data-part="coconut" cx="0" cy="1.5" r=".5"/>
            </g>
          </g></g>
    <g transform="translate(137 64) scale(.78)" style="--i:1"><path data-part="trunk" d="M-.9 0C-1.2-6-.4-11 1-16.2L2-16C.8-11 .2-6 .9 0Z"/>
          <path data-part="trunk-ring" d="M-1-2.6H.9M-.95-5.3H.75M-.8-8H.65M-.5-10.7H.75M-.1-13.4H1.1"/>
          <path data-part="trunk-rim" d="M.9 0C.2-6 .8-11 2-16"/>
          <g transform="translate(1.5 -16)">
            <g data-part="crown">
              <path data-part="frond" transform="rotate(-14)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(18)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(44) scale(.8)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(-18)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(14)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(42) scale(.8)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(-58) scale(.62)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(-60) scale(.6)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <circle data-part="coconut" cx="-.5" cy=".7" r=".55"/>
              <circle data-part="coconut" cx=".5" cy=".9" r=".55"/>
              <circle data-part="coconut" cx="0" cy="1.5" r=".5"/>
            </g>
          </g></g>
    <g transform="translate(168 64.5) scale(.9) rotate(4)" style="--i:2"><path data-part="trunk" d="M-.9 0C-1.2-6-.4-11 1-16.2L2-16C.8-11 .2-6 .9 0Z"/>
          <path data-part="trunk-ring" d="M-1-2.6H.9M-.95-5.3H.75M-.8-8H.65M-.5-10.7H.75M-.1-13.4H1.1"/>
          <path data-part="trunk-rim" d="M.9 0C.2-6 .8-11 2-16"/>
          <g transform="translate(1.5 -16)">
            <g data-part="crown">
              <path data-part="frond" transform="rotate(-14)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(18)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(44) scale(.8)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(-18)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(14)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(42) scale(.8)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="rotate(-58) scale(.62)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <path data-part="frond" transform="scale(-1 1) rotate(-60) scale(.6)" d="M0 0C2.5-2 6-2 8.5 1.2 7.6.4 7.4 1.2 6.6.4 6.4 1.2 5.5.4 5.3 1.1 4.4.4 4.2 1 3.3.4 3 .9 2.2.5 1.9.8 1.2.5Q.6.5 0 0Z"/>
              <circle data-part="coconut" cx="-.5" cy=".7" r=".55"/>
              <circle data-part="coconut" cx=".5" cy=".9" r=".55"/>
              <circle data-part="coconut" cx="0" cy="1.5" r=".5"/>
            </g>
          </g></g>
    <path data-part="bush" d="M122.6 65.6c-.3-1.6 1-2.6 2.2-2 .5-1.4 2.4-1.5 3 0 1.2-.5 2.4.4 2.2 2ZM132.6 65.6c-.2-1.2.8-2 1.7-1.5.5-1 1.9-1 2.3.1 1-.3 1.8.4 1.6 1.4ZM164 65.4c-.3-1.4.9-2.3 2-1.8.5-1.2 2.2-1.3 2.7 0 1.1-.4 2.1.4 1.9 1.8ZM170.4 65.6c-.2-1 .6-1.7 1.4-1.3.4-.8 1.6-.8 1.9.1.8-.2 1.5.4 1.3 1.2Z"/>
    <g transform="translate(134.4 66.6)">
      <g data-part="reeds" style="--i:0">
        <path data-part="reed" d="M0 0-.6-4M.8 0 .9-4.6M1.6 0 2.3-3.6"/>
        <path data-part="cattail" d="M-.55-3.6-.7-4.6M.9-4.2v-1.1"/>
      </g>
    </g>
    <g transform="translate(164.4 66.4)">
      <g data-part="reeds" style="--i:1">
        <path data-part="reed" d="M0 0 .5-3.8M.8 0 .4-4.4M1.6 0 1.9-3.2"/>
        <path data-part="cattail" d="M.45-3.4.55-4.4M.42-4 .38-5.1"/>
      </g>
    </g>
    <circle data-part="firefly" style="--i:0" cx="132" cy="58" r=".5"/>
    <circle data-part="firefly" style="--i:1" cx="144" cy="60" r=".45"/>
    <circle data-part="firefly" style="--i:2" cx="160" cy="57" r=".5"/>
    <circle data-part="firefly" style="--i:3" cx="171" cy="61" r=".4"/>
  </g>
  <g data-part="layer-front">
    <path data-part="dune-front" d="M-40 75C0 69.5 30 69.5 60 72S120 78 160 75 220 71 240 73V110H-40Z"/>
    <g transform="translate(12 70.6)"><path data-part="tuft" d="M0 0-1.4-3.2M0 0 .2-3.8M0 0 1.6-3"/></g>
    <g transform="translate(70 72.6)"><path data-part="tuft" style="--i:1" d="M0 0-1.2-2.8M0 0 .3-3.4M0 0 1.4-2.6"/></g>
    <g transform="translate(186 71.6)"><path data-part="tuft" style="--i:2" d="M0 0-1.4-3M0 0 .2-3.6M0 0 1.5-2.8"/></g>
    <g data-part="sand">
      <path data-part="sand-grain" d="M-60 69.6h.1M-51 71.8h.1M-43 68.9h.1M-34 72.6h.1M-27 70.4h.1M-16 69.2h.1M-8 71.2h.1M0 69.6h.1M9 71.8h.1M17 68.9h.1M26 72.6h.1M33 70.4h.1M44 69.2h.1M52 71.2h.1M60 69.6h.1M69 71.8h.1M77 68.9h.1M86 72.6h.1M93 70.4h.1M104 69.2h.1M112 71.2h.1M120 69.6h.1M129 71.8h.1M137 68.9h.1M146 72.6h.1M153 70.4h.1M164 69.2h.1M172 71.2h.1M180 69.6h.1M189 71.8h.1M197 68.9h.1M206 72.6h.1M213 70.4h.1M224 69.2h.1M232 71.2h.1M240 69.6h.1M249 71.8h.1M257 68.9h.1M266 72.6h.1M273 70.4h.1M284 69.2h.1M292 71.2h.1"/>
      <path data-part="sand-streak" d="M-56 70.6h7M-24 72h5M4 70.6h7M36 72h5M64 70.6h7M96 72h5M124 70.6h7M156 72h5M184 70.6h7M216 72h5M244 70.6h7M276 72h5"/>
    </g>
  </g>
</svg>`;

/** A playing video of a night caravan: the play press fades, then the scene pans while the clock and progress bar run. */
export const renderVideoPreview = (): HTMLElement => {
  const scene = h('div', { 'data-part': 'scene' });

  scene.innerHTML = SCENE;

  const track = h(
    'div',
    { 'data-part': 'track' },
    h('div', { 'data-part': 'fill' }),
    h('div', { 'data-part': 'head' })
  );

  return createPreview(
    'video',
    h(
      'div',
      { 'data-part': 'frame' },
      scene,
      glyph('disc', IconPlayerPlay),
      h(
        'div',
        { 'data-part': 'bar' },
        track,
        h(
          'div',
          { 'data-part': 'row' },
          glyph('play', IconPlayerPause),
          h(
            'span',
            { 'data-part': 'time' },
            h('span', { 'data-part': 'elapsed' }),
            ' / ',
            h('span', { 'data-part': 'duration' }, '0:24')
          ),
          h('span', { 'data-part': 'spacer' }),
          glyph('icon', IconPlayerVolume),
          glyph('icon', IconExpandFullscreen)
        )
      )
    )
  );
};
