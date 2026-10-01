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
<svg viewBox="0 0 196 110" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true" focusable="false">
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
        <path data-part="camel" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2 2.2-5.4 2.8-5 3.4-4.8 4-5.6 4.3-7.2 4.8-8 5.2-8.5 6.2-8.6 6.8-8.1L7.2-7.4 6.2-7.3C5.6-6.6 5.4-5 4.6-3.8 4.2-3.1 3.4-2.8 2.6-2.8H-3.4C-4.2-2.9-4.6-3.4-4.5-4.2Z"/>
          <path data-part="leg" d="M-3.2-3.1V0"/>
          <path data-part="leg" data-lag="" d="M-2.3-3.1V0"/>
          <path data-part="leg" data-lag="" d="M3.4-3.1V0"/>
          <path data-part="leg" d="M2.5-3.1V0"/>
        <path data-part="rider" d="M-1 -7.6-.4-9.8H.6L1.2-7.6ZM.1-10.4a.75.75 0 1 0 0-.1Z"/>
        <circle data-part="lantern" cx="1.8" cy="-8.4" r=".55"/>
        <g transform="translate(-11 0)">
          <path data-part="camel" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2 2.2-5.4 2.8-5 3.4-4.8 4-5.6 4.3-7.2 4.8-8 5.2-8.5 6.2-8.6 6.8-8.1L7.2-7.4 6.2-7.3C5.6-6.6 5.4-5 4.6-3.8 4.2-3.1 3.4-2.8 2.6-2.8H-3.4C-4.2-2.9-4.6-3.4-4.5-4.2Z"/>
          <path data-part="leg" d="M-3.2-3.1V0"/>
          <path data-part="leg" data-lag="" d="M-2.3-3.1V0"/>
          <path data-part="leg" data-lag="" d="M3.4-3.1V0"/>
          <path data-part="leg" d="M2.5-3.1V0"/>
          <path data-part="pack" d="M-2.4-7.2h3.4v1.4h-3.4Z"/>
        </g>
        <g transform="translate(-22 0)">
          <path data-part="camel" d="M-4.5-4.2C-4.6-5.6-3.4-6.4-2.2-6.3-1.2-8 .8-8 1.6-6.2 2.2-5.4 2.8-5 3.4-4.8 4-5.6 4.3-7.2 4.8-8 5.2-8.5 6.2-8.6 6.8-8.1L7.2-7.4 6.2-7.3C5.6-6.6 5.4-5 4.6-3.8 4.2-3.1 3.4-2.8 2.6-2.8H-3.4C-4.2-2.9-4.6-3.4-4.5-4.2Z"/>
          <path data-part="leg" d="M-3.2-3.1V0"/>
          <path data-part="leg" data-lag="" d="M-2.3-3.1V0"/>
          <path data-part="leg" data-lag="" d="M3.4-3.1V0"/>
          <path data-part="leg" d="M2.5-3.1V0"/>
          <path data-part="pack" d="M-2.4-7.2h3.4v1.4h-3.4Z"/>
        </g>
      </g>
    </g>
  </g>
  <g data-part="layer-near">
    <path data-part="dune" d="M-40 70C-10 64 20 62.5 50 64.5S100 68 128 64 190 61 240 64V110H-40Z"/>
    <path data-part="ridge" d="M-40 70C-10 64 20 62.5 50 64.5S100 68 128 64 190 61 240 64"/>
    <ellipse data-part="fire-glow" cx="46" cy="65" rx="16" ry="3.2"/>
    <circle data-part="fire-glow" cx="46" cy="61.5" r="6"/>
    <g transform="translate(28 65)">
      <path data-part="tent" d="M0 0 5.5-8 11 0Z"/>
      <path data-part="tent-door" d="M4.2 0 5.5-3.6 6.8 0Z"/>
      <path data-part="tent-pole" d="M5.5-8l-.6-1.4M5.5-8l.7-1.3"/>
    </g>
    <path data-part="sitter" d="M52 65.4l.4-2.6c.1-.8 1.4-.8 1.6 0l.6 2.6ZM53.2 61.6a.75.75 0 1 0 0-.1Z"/>
    <g transform="translate(46 65)">
      <path data-part="log" d="M-2.4.2 2-.9M-2-.9 2.4.2"/>
      <path data-part="flame" d="M0-6C1.8-3.8 2-1.7 0-.4-2-1.7-1.8-3.8 0-6Z"/>
      <path data-part="flame-core" d="M0-3.8C1-2.5 1.1-1.3 0-.5-1.1-1.3-1-2.5 0-3.8Z"/>
      <circle data-part="ember" style="--i:0" cx="0" cy="-5" r=".4"/>
      <circle data-part="ember" style="--i:1" cx=".5" cy="-5" r=".3"/>
      <circle data-part="ember" style="--i:2" cx="-.4" cy="-5" r=".35"/>
      <circle data-part="ember" style="--i:3" cx=".2" cy="-5" r=".3"/>
      <path data-part="smoke" style="--i:0" d="M0-7q-1-1.4 0-2.8t0-2.8"/>
      <path data-part="smoke" style="--i:1" d="M.4-7q1-1.2 0-2.4t0-2.4"/>
    </g>
    <ellipse data-part="pond" cx="150" cy="67" rx="17" ry="2.8"/>
    <path data-part="pond-rim" d="M133.4 66.4Q150 63.6 166.6 66.4"/>
    <path data-part="reflection" style="--i:0" d="M148 65.6h8"/>
    <path data-part="reflection" style="--i:1" d="M149 66.9h6"/>
    <path data-part="reflection" style="--i:2" d="M150.2 68.2h3.6"/>
    <g transform="translate(128 65)"><path data-part="trunk" d="M0 0Q-1.2-8 1.5-16"/>
          <g data-part="crown">
            <path data-part="frond" d="M1.5-16Q-2.5-18.5-6.5-15M1.5-16Q-1.5-20-5.5-19.5M1.5-16Q2.5-20.5 6.5-20M1.5-16Q5.5-18 9.5-14.5M1.5-16Q4.5-16 7-12.5M1.5-16Q-.5-15-2.5-11.5"/>
            <path data-part="coconut" d="M1.1-15.2h.1M2.1-15.1h.1"/>
          </g></g>
    <g transform="translate(137 64) scale(.78)" style="--i:1"><path data-part="trunk" d="M0 0Q-1.2-8 1.5-16"/>
          <g data-part="crown">
            <path data-part="frond" d="M1.5-16Q-2.5-18.5-6.5-15M1.5-16Q-1.5-20-5.5-19.5M1.5-16Q2.5-20.5 6.5-20M1.5-16Q5.5-18 9.5-14.5M1.5-16Q4.5-16 7-12.5M1.5-16Q-.5-15-2.5-11.5"/>
            <path data-part="coconut" d="M1.1-15.2h.1M2.1-15.1h.1"/>
          </g></g>
    <g transform="translate(168 64.5) scale(.9) rotate(4)"><path data-part="trunk" d="M0 0Q-1.2-8 1.5-16"/>
          <g data-part="crown">
            <path data-part="frond" d="M1.5-16Q-2.5-18.5-6.5-15M1.5-16Q-1.5-20-5.5-19.5M1.5-16Q2.5-20.5 6.5-20M1.5-16Q5.5-18 9.5-14.5M1.5-16Q4.5-16 7-12.5M1.5-16Q-.5-15-2.5-11.5"/>
            <path data-part="coconut" d="M1.1-15.2h.1M2.1-15.1h.1"/>
          </g></g>
    <path data-part="reed" d="M135 67.5l-.6-3M136 67.5l.2-3.4M164 67.4l.5-2.8M165 67.4l-.3-3.2"/>
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
    <path data-part="sand" d="M-60 69.5h1.6M-46 71.5h1M-33 68.6h1.3M-19 72.4h0.9M-8 70.2h1.2M0 69.5h1.6M14 71.5h1M27 68.6h1.3M41 72.4h0.9M52 70.2h1.2M60 69.5h1.6M74 71.5h1M87 68.6h1.3M101 72.4h0.9M112 70.2h1.2M120 69.5h1.6M134 71.5h1M147 68.6h1.3M161 72.4h0.9M172 70.2h1.2M180 69.5h1.6M194 71.5h1M207 68.6h1.3M221 72.4h0.9M232 70.2h1.2M240 69.5h1.6M254 71.5h1M267 68.6h1.3M281 72.4h0.9M292 70.2h1.2"/>
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
