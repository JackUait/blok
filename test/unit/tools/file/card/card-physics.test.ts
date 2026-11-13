import { describe, it, expect } from 'vitest';
import { createSprings, stepSprings, kickSprings, REST_POINTER } from '../../../../../src/tools/file/card/card-physics';

const el = (): HTMLElement => document.createElement('span');

/** Runs the springs for `seconds` at 60 fps; true while they still move. */
function run(state: ReturnType<typeof createSprings>, seconds: number): boolean {
  const frames = Math.round(seconds * 60);

  return Array.from({ length: frames }).reduce<boolean>((_, __) => stepSprings(state, 1 / 60), false);
}

describe('card springs', () => {
  it('rests tilted three degrees with nothing lifted', () => {
    const top = el();
    const state = createSprings({ stage: el(), top, unders: [], fx: 'pdf' });

    run(state, 2);

    expect(top.style.getPropertyValue('--blok-file-y')).toBe('0.00px');
    expect(top.style.getPropertyValue('--blok-file-r')).toBe('-3.00deg');
  });

  it('lifts the object twelve pixels on hover and leans it toward the pointer', () => {
    const top = el();
    const state = createSprings({ stage: el(), top, unders: [], fx: 'pdf' });

    state.hover = true;
    state.px = 1;
    run(state, 3);

    expect(top.style.getPropertyValue('--blok-file-y')).toBe('-12.00px');
    // -3 at rest, plus (1 - 0.5) * 5 toward the pointer.
    expect(top.style.getPropertyValue('--blok-file-r')).toBe('-0.50deg');
  });

  it('lifts the sheets under it less, each with its own tilt', () => {
    const top = el();
    const u1 = el();
    const u2 = el();
    const state = createSprings({ stage: el(), top, unders: [u1, u2], fx: 'pdf' });

    state.hover = true;
    state.px = 0.5;
    run(state, 4);

    expect(u1.style.getPropertyValue('--blok-file-y')).toBe('-6.00px');
    expect(u2.style.getPropertyValue('--blok-file-y')).toBe('-2.40px');
    // -3 + 3.2 * 1.8 and -3 - 3.4 * 1.8 while hovered.
    expect(u1.style.getPropertyValue('--blok-file-r')).toBe('2.76deg');
    expect(u2.style.getPropertyValue('--blok-file-r')).toBe('-9.12deg');
  });

  it('comes to rest and reports it, so the frame loop can stop', () => {
    const state = createSprings({ stage: el(), top: el(), unders: [], fx: 'pdf' });

    state.hover = true;
    run(state, 0.2);
    state.hover = false;

    expect(run(state, 5)).toBe(false);
  });

  it('follows the pointer with a smoothed value and returns to the rest point', () => {
    const stage = el();
    const state = createSprings({ stage, top: el(), unders: [], fx: 'video' });

    state.hover = true;
    state.px = 0.9;
    run(state, 3);
    expect(stage.style.getPropertyValue('--blok-file-p')).toBe('0.900');

    state.hover = false;
    run(state, 3);
    expect(stage.style.getPropertyValue('--blok-file-p')).toBe(REST_POINTER.video.toFixed(3));
  });

  it('moves the selected spreadsheet cell with the pointer, inside the columns the sheet has', () => {
    const stage = el();
    const state = createSprings({ stage, top: el(), unders: [], fx: 'spreadsheet', columns: 3 });

    run(state, 0.1);
    expect(stage.style.getPropertyValue('--blok-file-col')).toBe('1');

    state.hover = true;
    state.px = 0.99;
    run(state, 0.1);
    expect(stage.style.getPropertyValue('--blok-file-col')).toBe('2');

    state.px = 0;
    run(state, 0.1);
    expect(stage.style.getPropertyValue('--blok-file-col')).toBe('0');
  });

  it('spins the record up on hover and lets it coast to a stop', () => {
    const stage = el();
    const state = createSprings({ stage, top: el(), unders: [], fx: 'audio' });

    state.hover = true;
    run(state, 2);
    const spun = Number(stage.style.getPropertyValue('--blok-file-a'));
    expect(spun).toBeGreaterThan(200);

    state.hover = false;
    run(state, 0.5);
    const coasting = Number(stage.style.getPropertyValue('--blok-file-a'));
    expect(coasting).toBeGreaterThan(spun);

    expect(run(state, 10)).toBe(false);
  });

  it('drops the object on a download kick, the sheets under it less', () => {
    const top = el();
    const u1 = el();
    const state = createSprings({ stage: el(), top, unders: [u1], fx: 'pdf' });

    kickSprings(state);
    // One frame: the softer sheet under it overtakes the top object later in the swing.
    stepSprings(state, 1 / 60);

    const topY = parseFloat(top.style.getPropertyValue('--blok-file-y'));
    const underY = parseFloat(u1.style.getPropertyValue('--blok-file-y'));
    expect(topY).toBeGreaterThan(0.1);
    expect(underY).toBeGreaterThan(0);
    expect(underY).toBeLessThan(topY);
  });

  it('starts a new object below the card edge so it rises into place', () => {
    const top = el();
    const state = createSprings({ stage: el(), top, unders: [], fx: 'pdf', enterFrom: 40 });

    stepSprings(state, 0);
    expect(parseFloat(top.style.getPropertyValue('--blok-file-y'))).toBe(40);

    run(state, 3);
    expect(top.style.getPropertyValue('--blok-file-y')).toBe('0.00px');
  });
});
