import { TAB_SYNC_PROTOCOL } from './identity';

/**
 * `hello.stateVector` null = first join (the joiner resets and adopts a full
 * state); non-null = a tab that already joined asks only for what it missed
 * (wake). `recordId` is the saved document id, so a leader hand-off keeps
 * writing the same id. `claim` asks the leader to hand over; `yield` names
 * the tab that takes the lock and the version saved before it.
 */
export type TabMessage =
  | { kind: 'hello'; from: string; stateVector: Uint8Array | null }
  | { kind: 'state'; from: string; to: string; mode: 'full' | 'diff'; recordId: string; update: Uint8Array; version: string | null }
  | { kind: 'update'; from: string; update: Uint8Array }
  | { kind: 'saved'; from: string; version: string | null }
  | { kind: 'claim'; from: string }
  | { kind: 'yield'; from: string; to: string; version: string | null };

export interface Envelope { protocol: number; key: string; message: TabMessage }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const isNullableString = (value: unknown): value is string | null => value === null || isString(value);

// A structured clone can come from another realm (jsdom, iframes), where
// `instanceof` fails. Foreign bytes are copied into this realm so callers can
// rely on `instanceof Uint8Array`.
const toBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) {
    return value;
  }

  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
    : null;
};

const toMessage = (value: unknown): TabMessage | null => {
  if (!isRecord(value) || !isString(value.from)) {
    return null;
  }

  const { from } = value;

  switch (value.kind) {
    case 'hello': {
      if (value.stateVector === null) {
        return { kind: 'hello', from, stateVector: null };
      }
      const stateVector = toBytes(value.stateVector);

      return stateVector === null ? null : { kind: 'hello', from, stateVector };
    }
    case 'state': {
      const update = toBytes(value.update);
      const { to, mode, recordId, version } = value;

      return isString(to) && (mode === 'full' || mode === 'diff') && isString(recordId) && update !== null && isNullableString(version)
        ? { kind: 'state', from, to, mode, recordId, update, version }
        : null;
    }
    case 'update': {
      const update = toBytes(value.update);

      return update === null ? null : { kind: 'update', from, update };
    }
    case 'saved':
      return isNullableString(value.version) ? { kind: 'saved', from, version: value.version } : null;
    case 'claim':
      return { kind: 'claim', from };
    case 'yield':
      return isString(value.to) && isNullableString(value.version) ? { kind: 'yield', from, to: value.to, version: value.version } : null;
    default:
      return null;
  }
};

export const wrap = (key: string, message: TabMessage): Envelope => ({ protocol: TAB_SYNC_PROTOCOL, key, message });

/**
 * Null for anything malformed, foreign-key, or another protocol version.
 * @param key - the channel key this tab listens on
 * @param data - raw data from the channel
 */
export const unwrap = (key: string, data: unknown): TabMessage | null => {
  if (!isRecord(data) || data.protocol !== TAB_SYNC_PROTOCOL || data.key !== key) {
    return null;
  }

  return toMessage(data.message);
};
