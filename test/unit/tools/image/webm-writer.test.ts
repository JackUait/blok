// @vitest-environment node
// Node, so mediabunny reads the bytes with Node's own Blob and TextDecoder.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import type { EncodedPacket } from 'mediabunny';

import { writeWebm } from '../../../../src/tools/image/webm-writer';
import type { WebmFrame } from '../../../../src/tools/image/webm-writer';

const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

/** Frames with the given delays (ms); `keys` lists the key frame indices. */
const framesOf = (delaysMs: number[], keys: number[]): WebmFrame[] =>
  delaysMs.map((delay, i) => ({
    data: new Uint8Array(16).fill(i % 256),
    key: keys.includes(i),
    timestamp: delaysMs.slice(0, i).reduce((sum, d) => sum + d, 0) * 1000,
    duration: delay * 1000,
  }));

interface Parsed {
  codec: string | null;
  width: number;
  height: number;
  duration: number;
  packets: EncodedPacket[];
}

const parse = async (bytes: Uint8Array): Promise<Parsed> => {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  const track = await input.getPrimaryVideoTrack();

  if (!track) throw new Error('no video track');

  const packets: EncodedPacket[] = [];

  for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet);

  return {
    codec: track.codec,
    width: track.codedWidth,
    height: track.codedHeight,
    duration: await input.computeDuration(),
    packets,
  };
};

const keyIndices = (packets: EncodedPacket[]): number[] =>
  packets.flatMap((packet, i) => (packet.type === 'key' ? [i] : []));

const clusterCount = (bytes: Uint8Array): number =>
  bytes.reduce((count, _byte, i) => (CLUSTER_ID.every((b, j) => bytes[i + j] === b) ? count + 1 : count), 0);

describe('writeWebm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('writes a VP9 track whose packets, key frames, size and duration match the frames', async () => {
    const delays = Array.from({ length: 20 }, () => 100);
    const parsed = await parse(writeWebm({ codec: 'V_VP9', width: 160, height: 120 }, framesOf(delays, [0])));

    expect(keyIndices(parsed.packets)).toEqual([0]);
    expect(parsed.packets).toHaveLength(20);
    expect(parsed.codec).toBe('vp9');
    expect([parsed.width, parsed.height]).toEqual([160, 120]);
    expect(parsed.duration).toBeCloseTo(2, 6);
    expect(parsed.packets.at(-1)?.duration).toBeCloseTo(0.1, 6);
  });

  it('writes a VP8 track', async () => {
    const parsed = await parse(writeWebm({ codec: 'V_VP8', width: 32, height: 16 }, framesOf([100, 100, 100], [0])));

    expect(parsed.codec).toBe('vp8');
    expect([parsed.width, parsed.height]).toEqual([32, 16]);
    expect(parsed.packets).toHaveLength(3);
  });

  it('keeps every frame payload byte for byte', async () => {
    const frames = framesOf([100, 100, 100], [0]);
    const parsed = await parse(writeWebm({ codec: 'V_VP9', width: 4, height: 4 }, frames));

    expect(parsed.packets.map((packet) => Array.from(packet.data))).toEqual(frames.map((f) => Array.from(f.data)));
  });

  it('keeps variable delays, the last one included', async () => {
    const delays = [100, 250, 40, 1000, 70];
    const parsed = await parse(writeWebm({ codec: 'V_VP9', width: 4, height: 4 }, framesOf(delays, [0])));

    expect(parsed.packets.map((packet) => Math.round(packet.timestamp * 1000))).toEqual([0, 100, 350, 390, 1390]);
    expect(parsed.duration).toBeCloseTo(1.46, 6);
    expect(parsed.packets.at(-1)?.duration).toBeCloseTo(0.07, 6);
  });

  it('starts a new cluster on a key frame at least one second into the cluster', async () => {
    const delays = Array.from({ length: 30 }, () => 100);
    const bytes = writeWebm({ codec: 'V_VP9', width: 4, height: 4 }, framesOf(delays, [0, 5, 15]));
    const parsed = await parse(bytes);

    // Key at 500 ms is too soon for a cluster; the key at 1500 ms opens the second one.
    expect(clusterCount(bytes)).toBe(2);
    expect(keyIndices(parsed.packets)).toEqual([0, 5, 15]);
    expect(parsed.packets.map((packet) => Math.round(packet.timestamp * 1000))).toEqual(delays.map((_d, i) => i * 100));
  });

  it('splits clusters before block times pass 32 767 ms, even with one key frame', async () => {
    const delays = Array.from({ length: 70 }, () => 1000);
    const bytes = writeWebm({ codec: 'V_VP9', width: 4, height: 4 }, framesOf(delays, [0]));
    const parsed = await parse(bytes);

    expect(parsed.packets.map((packet) => Math.round(packet.timestamp))).toEqual(delays.map((_d, i) => i));
    expect(clusterCount(bytes)).toBe(3);
    expect(keyIndices(parsed.packets)).toEqual([0]);
    expect(parsed.duration).toBeCloseTo(70, 6);
  });

  it('marks a key last frame as key', async () => {
    const parsed = await parse(writeWebm({ codec: 'V_VP9', width: 4, height: 4 }, framesOf([100, 100], [0, 1])));

    expect(keyIndices(parsed.packets)).toEqual([0, 1]);
  });
});
