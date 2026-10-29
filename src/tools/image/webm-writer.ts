// One-video-track WebM writer. The whole file is built in memory at the end,
// so every element size is known and nothing is back-patched.

export interface WebmFrame {
  data: Uint8Array;
  key: boolean;
  /** µs */
  timestamp: number;
  /** µs */
  duration: number;
}

export interface WebmTrack {
  codec: 'V_VP9' | 'V_VP8';
  width: number;
  height: number;
}

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  tracks: 0x1654ae6b,
  cluster: 0x1f43b675,
  cues: 0x1c53bb6b,
} as const;

const CLUSTER_MIN_MS = 1000;
// Block times are int16 offsets from the cluster time.
const CLUSTER_MAX_OFFSET_MS = 32767;

const text = new TextEncoder();

/** Big-endian bytes of `n`, at least `width` long. */
const bytesOf = (n: number, width = 1): number[] => {
  const length = Math.max(width, Math.ceil(n.toString(16).length / 2));

  return Array.from({ length }, (_unused, i) => Math.floor(n / 256 ** (length - 1 - i)) % 256);
};

const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));

  parts.reduce((offset, part) => {
    out.set(part, offset);

    return offset + part.length;
  }, 0);

  return out;
};

// Sizes always use the 8-byte form, so a size never changes an element's length.
const size = (n: number): Uint8Array => Uint8Array.from([0x01, ...bytesOf(n, 7)]);

const el = (id: number, ...body: Uint8Array[]): Uint8Array => {
  const data = concat(body);

  return concat([Uint8Array.from(bytesOf(id)), size(data.length), data]);
};

const uint = (id: number, n: number, width = 1): Uint8Array => el(id, Uint8Array.from(bytesOf(n, width)));

const str = (id: number, s: string): Uint8Array => el(id, text.encode(s));

const float = (id: number, x: number): Uint8Array => {
  const bytes = new Uint8Array(8);

  new DataView(bytes.buffer).setFloat64(0, x);

  return el(id, bytes);
};

const int16 = (n: number): Uint8Array => {
  const bytes = new Uint8Array(2);

  new DataView(bytes.buffer).setInt16(0, n);

  return bytes;
};

// ReferenceBlock is a signed int of any length; 4 bytes covers any GIF delay.
const int32 = (n: number): Uint8Array => {
  const bytes = new Uint8Array(4);

  new DataView(bytes.buffer).setInt32(0, n);

  return bytes;
};

const ms = (us: number): number => Math.round(us / 1000);

/** Track 1, then the int16 time offset, then the flags byte. */
const blockHead = (offset: number, flags: number): Uint8Array => concat([Uint8Array.of(0x81), int16(offset), Uint8Array.of(flags)]);

/**
 * The last frame goes in a BlockGroup so its BlockDuration keeps its full delay.
 * A BlockGroup with no ReferenceBlock counts as a key frame, so a delta one names the frame before.
 */
const lastBlock = (frame: WebmFrame, offset: number, previous: WebmFrame | undefined): Uint8Array => {
  const reference = frame.key || !previous ? [] : [el(0xfb, int32(ms(previous.timestamp) - ms(frame.timestamp)))];

  return el(0xa0, el(0xa1, blockHead(offset, 0), frame.data), uint(0x9b, ms(frame.duration)), ...reference);
};

const simpleBlock = (frame: WebmFrame, offset: number): Uint8Array =>
  el(0xa3, blockHead(offset, frame.key ? 0x80 : 0), frame.data);

interface Cluster { time: number; key: boolean; blocks: Uint8Array[] }

const clustersOf = (frames: WebmFrame[]): Cluster[] =>
  frames.reduce<Cluster[]>((clusters, frame, i) => {
    const time = ms(frame.timestamp);
    const open = clusters.at(-1);
    const fresh = !open || (frame.key && time - open.time >= CLUSTER_MIN_MS) || time - open.time >= CLUSTER_MAX_OFFSET_MS;
    const cluster = fresh || !open ? { time, key: frame.key, blocks: [] } : open;

    if (cluster !== open) clusters.push(cluster);
    cluster.blocks.push(i === frames.length - 1
      ? lastBlock(frame, time - cluster.time, frames[i - 1])
      : simpleBlock(frame, time - cluster.time));

    return clusters;
  }, []);

const seekHead = (infoPos: number, tracksPos: number, cuesPos: number): Uint8Array => el(ID.seekHead,
  ...[[ID.info, infoPos], [ID.tracks, tracksPos], [ID.cues, cuesPos]].map(([id, pos]) =>
    // Fixed 8-byte positions: the SeekHead's length is known before the offsets are.
    el(ID.seek, el(ID.seekId, Uint8Array.from(bytesOf(id))), uint(ID.seekPosition, pos, 8))),
);

/**
 * Build a WebM file holding one VP8/VP9 video track. Frames must be in decode
 * order with the first one a key frame.
 */
export const writeWebm = (track: WebmTrack, frames: WebmFrame[]): Uint8Array<ArrayBuffer> => {
  const last = frames.at(-1);
  const durationMs = last ? ms(last.timestamp + last.duration) : 0;

  const clusters = clustersOf(frames).map((cluster) => ({
    time: cluster.time,
    key: cluster.key,
    bytes: el(ID.cluster, uint(0xe7, cluster.time), ...cluster.blocks),
  }));

  const info = el(ID.info, uint(0x2ad7b1, 1_000_000), str(0x4d80, 'blok'), str(0x5741, 'blok'), float(0x4489, durationMs));
  const tracks = el(ID.tracks, el(0xae,
    uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), str(0x86, track.codec),
    el(0xe0, uint(0xb0, track.width), uint(0xba, track.height)),
  ));

  // Positions are relative to the start of the Segment's data.
  const infoPos = seekHead(0, 0, 0).length;
  const tracksPos = infoPos + info.length;
  const clusterPositions = clusters.reduce<number[]>(
    (positions, cluster, i) => [...positions, i === 0 ? tracksPos + tracks.length : positions[i - 1] + clusters[i - 1].bytes.length],
    [],
  );
  const cuesPos = tracksPos + tracks.length + clusters.reduce((sum, cluster) => sum + cluster.bytes.length, 0);
  // A seek lands on a cluster's first frame, so only key-led clusters get a cue.
  const cues = el(ID.cues, ...clusters.flatMap((cluster, i) => cluster.key
    ? [el(0xbb, uint(0xb3, cluster.time), el(0xb7, uint(0xf7, 1), uint(0xf1, clusterPositions[i])))]
    : []));

  const header = el(ID.ebml,
    uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8),
    str(0x4282, 'webm'), uint(0x4287, 2), uint(0x4285, 2),
  );

  return concat([
    header,
    el(ID.segment, seekHead(infoPos, tracksPos, cuesPos), info, tracks, ...clusters.map((cluster) => cluster.bytes), cues),
  ]);
};
