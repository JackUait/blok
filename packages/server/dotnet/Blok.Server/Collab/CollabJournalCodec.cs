using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Blok.Server.Collab;

/// <summary>How one journal record decoded from bytes.</summary>
internal enum CollabJournalRecordStatus
{
  /// <summary>The record decoded and both its header and body checksums verified.</summary>
  Ok,

  /// <summary>
  /// Fewer bytes are present than a complete header, or the header is complete
  /// and honest but the body it promises is not fully present. This is what a
  /// process killed mid-append leaves behind: the write never finished, so
  /// nothing durable is lost by discarding it. It can only be legitimate at
  /// the physical end of the input — nothing was ever written past a genuine
  /// crash, so there is nothing "after" a torn record.
  /// </summary>
  Incomplete,

  /// <summary>
  /// The header checksum does not match, or the header is good but the body
  /// does not check out (bad version, bad body checksum, an inner length that
  /// does not fit, a domain invariant violated). An ordinary crash never
  /// produces this — it only truncates. This can only mean the bytes were
  /// altered or lost after being fully written, so the caller must refuse to
  /// proceed rather than skip past it.
  /// </summary>
  Invalid,
}

/// <summary>
/// Binary format for one durable collaboration-operation record, as appended
/// to a per-document journal.
/// </summary>
/// <remarks>
/// <para>
/// Layout (all multi-byte integers little-endian). The record is split into a
/// small fixed HEADER and a variable-length BODY, each independently
/// checksummed:
/// <code>
/// [0..3]    bodyLength        int32   bytes in the body that follows the header
/// [4]       version           byte    codec version (1, as of this format)
/// [5]       source            byte    CollabOperationSource
/// [6..37]   headerChecksum    32 raw bytes, SHA-256 over bytes [0..6)
/// ---- header ends here (38 bytes total); body starts here ----
/// [0..15]   operationId       16 raw bytes (32 lowercase-hex chars decoded)
/// [16..23]  serverSequence    uint64
/// [24..31]  committedAt       int64   UTC ticks
/// [32..35]  actorIdLength     int32   -1 = null actor, else UTF-8 byte count
/// [36..]    actorId           UTF-8 bytes, present iff actorIdLength >= 0
/// [..+32]   digest            32 raw bytes, SHA-256, stored verbatim
/// [..+4]    updateLength      int32
/// [..+N]    update            N bytes, the raw Yjs update (or opaque bytes)
/// [..+32]   bodyChecksum      32 raw bytes, SHA-256 over operationId..update
/// </code>
/// </para>
/// <para>
/// THE HEADER IS CHECKSUMMED SEPARATELY FROM THE BODY, and this is what makes
/// a torn tail structurally distinguishable from corruption ANYWHERE in the
/// record, including in <c>bodyLength</c> itself. A single trailing checksum
/// over the whole record cannot do this: <c>bodyLength</c> would then be
/// trusted before anything validates it, so a corrupted length that happens
/// to overrun the remaining bytes is indistinguishable from an honest
/// truncation. With the header independently checksummed, exactly three
/// outcomes are possible and every one is decidable from the bytes alone:
/// <list type="bullet">
/// <item>fewer bytes remain than a complete header → <see cref="CollabJournalRecordStatus.Incomplete"/> (torn tail);</item>
/// <item>the header is complete but its checksum fails → <see cref="CollabJournalRecordStatus.Invalid"/> (corruption, wherever it sits — a torn write never alters bytes it already wrote, only fails to write more);</item>
/// <item>the header is good but the body it declares is not fully present → <see cref="CollabJournalRecordStatus.Incomplete"/> (torn tail).</item>
/// </list>
/// A reader that conflated these would have to choose between discarding
/// acknowledged history (treating corruption as a torn tail) or refusing to
/// start after every ordinary crash (treating a torn tail as corruption).
/// </para>
/// <para>
/// Every length is checked against a fixed ceiling AND the bytes that remain
/// BEFORE it is used to slice or allocate: these bytes reach disk after a
/// network write the codec does not control, so a length field is exactly as
/// hostile as any other wire input. The header checksum guards against an
/// ACCIDENTAL corruption of <c>bodyLength</c> reaching the ceiling/remaining
/// checks at all; the ceiling check still guards against a value an attacker
/// wrote directly and checksummed honestly — the two checks defend against
/// different adversaries and neither substitutes for the other.
/// </para>
/// <para>
/// <c>Digest</c> is stored exactly as supplied and never recomputed here: for
/// <see cref="CollabOperationSource.HttpEdit"/> it covers the canonical
/// request body, not <c>Update</c> — see <see cref="CollabOperationCandidate.Digest"/>.
/// Deriving it from <c>Update</c> would silently break idempotent retry for
/// that source, which is exactly the source-blind design this codec keeps to.
/// </para>
/// </remarks>
internal static class CollabJournalCodec
{
  internal const int CurrentVersion = 1;

  private const int BodyLengthFieldSize = sizeof(int);
  private const int HeaderChecksumSize = 32; // SHA-256
  private const int BodyChecksumSize = 32; // SHA-256
  private const int DigestSize = 32; // SHA-256
  private const int OperationIdRawSize = 16; // 32 lowercase-hex chars decoded

  // bodyLength + version + source: the bytes the header checksum covers.
  private const int HeaderContentSize = BodyLengthFieldSize + sizeof(byte) + sizeof(byte);
  private const int HeaderSize = HeaderContentSize + HeaderChecksumSize;

  // operationId + sequence + ticks + actorIdLength + digest + updateLength
  private const int FixedBodyContentSize =
      OperationIdRawSize + sizeof(ulong) + sizeof(long) + sizeof(int) + DigestSize + sizeof(int);

  /// <summary>
  /// No fixed wire-level cap exists to derive this from —
  /// <see cref="CollabRoomOptions.AnnouncedMaxMessageBytes"/> is a
  /// runtime-configurable, default-null knob, not a compile-time constant.
  /// This is a disk-side backstop against an absurd allocation, NOT the
  /// enforcement policy: the store must still validate an append against the
  /// server's actually-configured wire limit. 32 MiB comfortably admits any
  /// real Yjs update or HTTP edit body while still bounding a corrupt or
  /// hostile length: a uniformly random 32-bit corruption of a length field
  /// lands inside this accepted range only ~0.8% of the time (2^25 / 2^32).
  /// </summary>
  internal const int MaxUpdateLength = 32 * 1024 * 1024;

  // Actor ids are short server-derived identities (a user id, an email), never payload-sized.
  private const int MaxActorIdLength = 4 * 1024;

  private const int MinBodyLength = FixedBodyContentSize + 1 + BodyChecksumSize; // update must be non-empty
  internal const int MaxBodyLength = FixedBodyContentSize + MaxActorIdLength + MaxUpdateLength + BodyChecksumSize;

  private static readonly UTF8Encoding Utf8 = new(
      encoderShouldEmitUTF8Identifier: false,
      throwOnInvalidBytes: true);

  internal static byte[] EncodeRecord(CollabOperationRecord record)
  {
    ArgumentNullException.ThrowIfNull(record);

    // Same 32-lowercase-hex shape as a lineage; SyncWire.RequireId already
    // reuses this validator for both lineage and operationId.
    if (!CollabWorkingSetTag.IsLineage(record.OperationId))
    {
      throw new ArgumentException(
          $"collab: the operation id {record.OperationId} is not 32 lowercase-hex characters.",
          nameof(record));
    }

    if (record.ServerSequence < 1)
    {
      throw new ArgumentException(
          "collab: server sequence 0 means nothing has been committed; a record must be at least 1.",
          nameof(record));
    }

    if (!Enum.IsDefined(record.Source))
    {
      throw new ArgumentException(
          $"collab: {record.Source} is not a known operation source.",
          nameof(record));
    }

    if (record.Digest.Length != DigestSize)
    {
      throw new ArgumentException(
          $"collab: the digest must be {DigestSize} bytes (SHA-256).",
          nameof(record));
    }

    if (record.Update.Length is 0 or > MaxUpdateLength)
    {
      throw new ArgumentException(
          $"collab: the update must be 1..{MaxUpdateLength} bytes.",
          nameof(record));
    }

    var actorIdBytes = record.ActorId is null ? null : Utf8.GetBytes(record.ActorId);

    if (actorIdBytes is { Length: > MaxActorIdLength })
    {
      throw new ArgumentException(
          $"collab: the actor id exceeds {MaxActorIdLength} bytes.",
          nameof(record));
    }

    var actorIdLength = actorIdBytes?.Length ?? -1;
    var bodyContentLength = FixedBodyContentSize + (actorIdBytes?.Length ?? 0) + record.Update.Length;
    var bodyLength = bodyContentLength + BodyChecksumSize;

    var buffer = new byte[HeaderSize + bodyLength];
    var span = buffer.AsSpan();

    BinaryPrimitives.WriteInt32LittleEndian(span, bodyLength);
    span[BodyLengthFieldSize] = CurrentVersion;
    span[BodyLengthFieldSize + 1] = (byte)record.Source;
    SHA256.HashData(span[..HeaderContentSize], span.Slice(HeaderContentSize, HeaderChecksumSize));

    var body = span.Slice(HeaderSize, bodyLength);
    var offset = 0;

    Convert.FromHexString(record.OperationId).CopyTo(body[offset..]);
    offset += OperationIdRawSize;
    BinaryPrimitives.WriteUInt64LittleEndian(body[offset..], record.ServerSequence);
    offset += sizeof(ulong);
    BinaryPrimitives.WriteInt64LittleEndian(body[offset..], record.CommittedAt.UtcTicks);
    offset += sizeof(long);
    BinaryPrimitives.WriteInt32LittleEndian(body[offset..], actorIdLength);
    offset += sizeof(int);

    if (actorIdBytes is not null)
    {
      actorIdBytes.CopyTo(body[offset..]);
      offset += actorIdBytes.Length;
    }

    record.Digest.Span.CopyTo(body[offset..]);
    offset += DigestSize;
    BinaryPrimitives.WriteInt32LittleEndian(body[offset..], record.Update.Length);
    offset += sizeof(int);
    record.Update.Span.CopyTo(body[offset..]);
    offset += record.Update.Length;

    SHA256.HashData(body[..offset], body.Slice(offset, BodyChecksumSize));

    return buffer;
  }

  internal static CollabJournalRecordStatus TryDecodeRecord(
      ReadOnlySpan<byte> input,
      out CollabOperationRecord? record,
      out int consumed,
      out string error)
  {
    record = null;
    consumed = 0;
    error = "";

    if (input.Length < HeaderSize)
    {
      return CollabJournalRecordStatus.Incomplete;
    }

    var storedHeaderChecksum = input.Slice(HeaderContentSize, HeaderChecksumSize);
    Span<byte> computedHeaderChecksum = stackalloc byte[HeaderChecksumSize];
    SHA256.HashData(input[..HeaderContentSize], computedHeaderChecksum);

    // Verified before bodyLength/version/source are trusted for anything —
    // this is what keeps a corrupted length prefix from being mistaken for an
    // honest one that merely needs more bytes.
    if (!computedHeaderChecksum.SequenceEqual(storedHeaderChecksum))
    {
      error = "the header checksum does not match its content";

      return CollabJournalRecordStatus.Invalid;
    }

    var bodyLength = BinaryPrimitives.ReadInt32LittleEndian(input);
    var version = input[BodyLengthFieldSize];

    if (version != CurrentVersion)
    {
      error = $"unsupported codec version {version}";

      return CollabJournalRecordStatus.Invalid;
    }

    var sourceByte = input[BodyLengthFieldSize + 1];
    var source = (CollabOperationSource)sourceByte;

    if (!Enum.IsDefined(source))
    {
      error = $"unknown operation source {sourceByte}";

      return CollabJournalRecordStatus.Invalid;
    }

    // Checked against the absolute ceiling BEFORE comparing to what remains:
    // the header checksum only proves bodyLength was not accidentally
    // corrupted, not that it is a value an honest writer would ever produce —
    // a hostile actor can checksum whatever value it likes.
    if (bodyLength < MinBodyLength || bodyLength > MaxBodyLength)
    {
      error = $"the body length {bodyLength} is out of range";

      return CollabJournalRecordStatus.Invalid;
    }

    if (input.Length - HeaderSize < bodyLength)
    {
      return CollabJournalRecordStatus.Incomplete;
    }

    var body = input.Slice(HeaderSize, bodyLength);
    var bodyToHash = body[..^BodyChecksumSize];
    var storedBodyChecksum = body[^BodyChecksumSize..];

    // Verified before any body field is parsed, so a corrupted CommittedAt or
    // an inner length fails closed here rather than throwing out of a parser.
    Span<byte> computedBodyChecksum = stackalloc byte[BodyChecksumSize];
    SHA256.HashData(bodyToHash, computedBodyChecksum);

    if (!computedBodyChecksum.SequenceEqual(storedBodyChecksum))
    {
      error = "the body checksum does not match its content";

      return CollabJournalRecordStatus.Invalid;
    }

    var offset = 0;
    var operationId = Convert.ToHexStringLower(bodyToHash.Slice(offset, OperationIdRawSize));
    offset += OperationIdRawSize;

    var serverSequence = BinaryPrimitives.ReadUInt64LittleEndian(bodyToHash[offset..]);
    offset += sizeof(ulong);

    if (serverSequence < 1)
    {
      error = "server sequence 0 means nothing was committed on this lineage";

      return CollabJournalRecordStatus.Invalid;
    }

    var committedAtTicks = BinaryPrimitives.ReadInt64LittleEndian(bodyToHash[offset..]);
    offset += sizeof(long);

    if (committedAtTicks < 0 || committedAtTicks > DateTimeOffset.MaxValue.Ticks)
    {
      error = "committedAt is out of range";

      return CollabJournalRecordStatus.Invalid;
    }

    var actorIdLength = BinaryPrimitives.ReadInt32LittleEndian(bodyToHash[offset..]);
    offset += sizeof(int);

    if (actorIdLength is < -1 or > MaxActorIdLength || actorIdLength > bodyToHash.Length - offset)
    {
      error = "the actor id length is invalid";

      return CollabJournalRecordStatus.Invalid;
    }

    string? actorId = null;

    if (actorIdLength >= 0)
    {
      try
      {
        actorId = Utf8.GetString(bodyToHash.Slice(offset, actorIdLength));
      }
      catch (DecoderFallbackException)
      {
        error = "the actor id is not valid UTF-8";

        return CollabJournalRecordStatus.Invalid;
      }

      offset += actorIdLength;
    }

    if (bodyToHash.Length - offset < DigestSize)
    {
      error = "the digest is truncated";

      return CollabJournalRecordStatus.Invalid;
    }

    var digest = bodyToHash.Slice(offset, DigestSize).ToArray();
    offset += DigestSize;

    if (bodyToHash.Length - offset < sizeof(int))
    {
      error = "the update length is missing";

      return CollabJournalRecordStatus.Invalid;
    }

    var updateLength = BinaryPrimitives.ReadInt32LittleEndian(bodyToHash[offset..]);
    offset += sizeof(int);

    // Bound against the ceiling AND what actually remains: a checksum can be
    // honestly computed over bytes an attacker wrote directly, so passing it
    // does not by itself prove an inner length is safe to slice or allocate.
    if (updateLength < 1 || updateLength > MaxUpdateLength || updateLength > bodyToHash.Length - offset)
    {
      error = "the update length is invalid";

      return CollabJournalRecordStatus.Invalid;
    }

    var update = bodyToHash.Slice(offset, updateLength).ToArray();
    offset += updateLength;

    if (offset != bodyToHash.Length)
    {
      error = $"{bodyToHash.Length - offset} trailing byte(s) inside the record body";

      return CollabJournalRecordStatus.Invalid;
    }

    record = new CollabOperationRecord(
        operationId,
        serverSequence,
        new DateTimeOffset(committedAtTicks, TimeSpan.Zero),
        actorId,
        source,
        update,
        digest);
    consumed = HeaderSize + bodyLength;

    return CollabJournalRecordStatus.Ok;
  }
}
