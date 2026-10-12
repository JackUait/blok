// @vitest-environment node
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStdoutGuard } from '../../../src/mcp/stdout-guard';

const streams: Writable[] = [];

const captureStream = () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: unknown, _encoding, callback) {
      if (!Buffer.isBuffer(chunk)) {
        callback(new TypeError('Expected console output to be a Buffer'));

        return;
      }

      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });

  streams.push(stream);

  return { stream, chunks };
};

const captureConsole = () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const target = new Console({ stdout: stdout.stream, stderr: stderr.stream });

  return { target, stdout, stderr };
};

describe('stdout guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const stream of streams.splice(0)) {
      stream.destroy();
    }

    vi.restoreAllMocks();
  });

  it('routes log, info and debug through target.error to stderr', () => {
    const { target, stdout, stderr } = captureConsole();

    const error = vi.spyOn(target, 'error');

    installStdoutGuard(target);

    target.log('from bundled %s', 'core');
    target.info('info: %d', 42);
    target.debug('debug: %s', 'details');

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual(['from bundled core\n', 'info: 42\n', 'debug: details\n']);
    expect(error).toHaveBeenNthCalledWith(1, 'from bundled %s', 'core');
    expect(error).toHaveBeenNthCalledWith(2, 'info: %d', 42);
    expect(error).toHaveBeenNthCalledWith(3, 'debug: %s', 'details');
  });

  it('keeps warn and error on stderr', () => {
    const { target, stdout, stderr } = captureConsole();

    installStdoutGuard(target);
    target.warn('warning: %s', 'w');
    target.error('error: %s', 'e');

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual(['warning: w\n', 'error: e\n']);
  });

  it('leaves direct JSON-RPC writes on stdout', () => {
    const { target, stdout, stderr } = captureConsole();
    const frame = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n';

    installStdoutGuard(target);
    stdout.stream.write(frame);
    target.log('diagnostic');

    expect(stdout.chunks).toEqual([frame]);
    expect(stderr.chunks).toEqual(['diagnostic\n']);
  });

  it('does not redirect another Console instance', () => {
    const guarded = captureConsole();
    const other = captureConsole();

    installStdoutGuard(guarded.target);
    guarded.target.log('guarded');
    other.target.log('other');

    expect(guarded.stdout.chunks).toEqual([]);
    expect(guarded.stderr.chunks).toEqual(['guarded\n']);
    expect(other.stdout.chunks).toEqual(['other\n']);
    expect(other.stderr.chunks).toEqual([]);
  });
});
