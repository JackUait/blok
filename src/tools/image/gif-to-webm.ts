// Minimal structural types for the WebCodecs surface we use (avoids relying on
// lib.dom types that may not be present in the project's TS target).
interface DecodedFrame {
  displayWidth: number;
  displayHeight: number;
  duration: number | null;
  timestamp: number;
  close(): void;
}

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } };
  decode(opts: { frameIndex: number }): Promise<{ image: DecodedFrame; complete: boolean }>;
  close(): void;
}

interface EncodedChunk { type: string; }

interface VideoEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(frame: DecodedFrame, opts?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
}

interface VideoEncoderCtor {
  new (init: {
    output: (chunk: EncodedChunk, meta: unknown) => void;
    error: (err: unknown) => void;
  }): VideoEncoderLike;
  isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }>;
}

const KEYFRAME_INTERVAL = 30;

function hasWebCodecs(): boolean {
  const g = globalThis as Record<string, unknown>;
  return typeof g.ImageDecoder !== 'undefined' && typeof g.VideoEncoder !== 'undefined';
}

async function pickCodec(
  Encoder: VideoEncoderCtor,
  width: number,
  height: number,
): Promise<{ encoderCodec: string; muxerCodec: 'V_VP9' | 'V_VP8' } | null> {
  const candidates: Array<{ encoderCodec: string; muxerCodec: 'V_VP9' | 'V_VP8' }> = [
    { encoderCodec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
    { encoderCodec: 'vp8', muxerCodec: 'V_VP8' },
  ];
  for (const c of candidates) {
    const probe = await Encoder.isConfigSupported({ codec: c.encoderCodec, width, height });
    if (probe.supported) return c;
  }
  return null;
}

/**
 * Convert an animated GIF (raw bytes) into a WebM Blob using WebCodecs.
 * Returns null whenever the caller should keep the original GIF: WebCodecs
 * unavailable, a static/single-frame GIF, an unsupported codec, or any error.
 */
export async function convertGifToWebm(
  data: ArrayBuffer,
  opts: { onProgress?: (percent: number) => void } = {},
): Promise<Blob | null> {
  if (!hasWebCodecs()) return null;

  const g = globalThis as Record<string, unknown>;
  const DecoderCtor = g.ImageDecoder as new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike;
  const EncoderCtor = g.VideoEncoder as unknown as VideoEncoderCtor;

  let decoder: ImageDecoderLike | null = null;
  let encoder: VideoEncoderLike | null = null;
  const openFrames: DecodedFrame[] = [];

  try {
    decoder = new DecoderCtor({ data, type: 'image/gif' });
    await decoder.tracks.ready;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (frameCount <= 1) return null;

    const first = await decoder.decode({ frameIndex: 0 });
    openFrames.push(first.image);
    const width = first.image.displayWidth;
    const height = first.image.displayHeight;

    const codec = await pickCodec(EncoderCtor, width, height);
    if (!codec) return null;

    const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: codec.muxerCodec, width, height },
      firstTimestampBehavior: 'offset',
    });

    encoder = new EncoderCtor({
      output: (chunk, meta) => muxer.addVideoChunk(chunk as never, meta as never),
      error: () => undefined,
    });
    encoder.configure({
      codec: codec.encoderCodec,
      width,
      height,
      bitrate: Math.max(200_000, width * height * 4),
    });

    let timestamp = 0;
    for (let i = 0; i < frameCount; i++) {
      const frame = i === 0 ? first.image : (await decoder.decode({ frameIndex: i })).image;
      if (i !== 0) openFrames.push(frame);
      // Re-stamp so timestamps are monotonic from GIF delays (µs).
      const stamped = frame as DecodedFrame & { timestamp: number };
      stamped.timestamp = timestamp;
      encoder.encode(frame, { keyFrame: i % KEYFRAME_INTERVAL === 0 });
      timestamp += frame.duration ?? 100_000;
      opts.onProgress?.(Math.round(((i + 1) / frameCount) * 100));
    }

    await encoder.flush();
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/webm' });
  } catch {
    return null;
  } finally {
    openFrames.forEach((f) => {
      try { f.close(); } catch { /* already closed */ }
    });
    try { encoder?.close(); } catch { /* noop */ }
    try { decoder?.close(); } catch { /* noop */ }
  }
}
