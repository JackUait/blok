using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Blok.Server.Collab;

/// <summary>How one journal record decoded from bytes.</summary>
internal enum CollabJournalRecordStatus
{
  /// <summary>The record decoded and its checksum verified.</summary>
  Ok,

  /// <summary>
  /// Fewer bytes are present than the record's own length prefix promises.
  /// This is what a process killed mid-append leaves behind: the write never
  /// finished, so nothing durable is lost by discarding it. It can only be
  /// legitimate at the physical end of the input — nothing was ever written
  /// past a genuine crash, so there is nothing "after" a torn record.
  /// </summary>
  Incomplete,

  /// <summary>
  /// Every byte the length prefix promised is present, but the content does
  /// not check out (bad version, bad checksum, an inner length that does not
  /// fit, a domain invariant violated). An ordinary crash never produces
  /// this — it only truncates. This can only mean the bytes were altered or
  /// lost after being fully written, so the caller must refuse to proceed
  /// rather than skip past it.
  /// </summary>
  Invalid,
}

/// <summary>
/// Binary format for one durable collaboration-operation record, as appended
/// to a per-document journal.
/// </summary>
/// <remarks>
/// <para>
/// Layout (all multi-byte integers little-endian):
/// <code>
/// [0..3]    recordLength      int32   bytes that follow (version..checksum)
/// [4]       version           byte
/// [5]       source            byte    CollabOperationSource
/// [6..21]   operationId       16 raw bytes (32 lowercase-hex chars decoded)
/// [22..29]  serverSequence    uint64
/// [30..37]  committedAt       int64   UTC ticks
/// [38..41]  actorIdLength     int32   -1 = null actor, else UTF-8 byte count
/// [42..]    actorId           UTF-8 bytes, present iff actorIdLength >= 0
/// [..+32]   digest            32 raw bytes, SHA-256, stored verbatim
/// [..+4]    updateLength      int32
/// [..+N]    update            N bytes, the raw Yjs update (or opaque bytes)
/// [..+32]   checksum          32 raw bytes, SHA-256 over version..update
/// </code>
/// </para>
/// <para>
/// Two integrity mechanisms cover two different failures. The length prefix
/// is what makes a torn tail (a crash mid-append) detectable — see
/// <see cref="CollabJournalRecordStatus.Incomplete"/>. The trailing checksum
/// is what makes bytes altered or lost anywhere else detectable — see
/// <see cref="CollabJournalRecordStatus.Invalid"/>. A reader that conflated
/// the two would have to choose between discarding acknowledged history
/// (treating corruption as a torn tail) or refusing to start after every
/// ordinary crash (treating a torn tail as corruption).
/// </para>
/// <para>
/// Every length is checked against a fixed ceiling AND the bytes that remain
/// BEFORE it is used to slice or allocate: these bytes reach disk after a
/// network write the codec does not control, so a length field is exactly as
/// hostile as any other wire input.
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

  private const int LengthPrefixSize = sizeof(int);
  private const int DigestSize = 32; // SHA-256
  private const int ChecksumSize = 32; // SHA-256
  private const int OperationIdRawSize = 16; // 32 lowercase-hex chars decoded

  // version + source + operationId + sequence + ticks + actorIdLength + digest + updateLength
  private const int FixedContentSize =
      sizeof(byte) + sizeof(byte) + OperationIdRawSize + sizeof(ulong) +
      sizeof(long) + sizeof(int) + DigestSize + sizeof(int);

  /// <summary>
  /// No fixed wire-level cap exists to derive this from —
  /// <see cref="CollabRoomOptions.AnnouncedMaxMessageBytes"/> is a
  /// runtime-configurable, default-null knob, not a compile-time constant.
  /// 32 MiB comfortably admits any real Yjs update or HTTP edit body while
  /// still bounding a corrupt or hostile length: a uniformly random 32-bit
  /// corruption of a length field lands inside this accepted range only
  /// ~0.8% of the time (2^25 / 2^32).
  /// </summary>
  internal const int MaxUpdateLength = 32 * 1024 * 1024;

  // Actor ids are short server-derived identities (a user id, an email), never payload-sized.
  private const int MaxActorIdLength = 4 * 1024;

  private const int MinRecordLength = FixedContentSize + 1 + ChecksumSize; // update must be non-empty
  internal const int MaxRecordLength = FixedContentSize + MaxActorIdLength + MaxUpdateLength + ChecksumSize;

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
    var contentLength = FixedContentSize + (actorIdBytes?.Length ?? 0) + record.Update.Length;
    var recordLength = contentLength + ChecksumSize;

    var buffer = new byte[LengthPrefixSize + recordLength];
    var span = buffer.AsSpan();

    BinaryPrimitives.WriteInt32LittleEndian(span, recordLength);

    var content = span.Slice(LengthPrefixSize, recordLength);
    var offset = 0;

    content[offset++] = CurrentVersion;
    content[offset++] = (byte)record.Source;
    Convert.FromHexString(record.OperationId).CopyTo(content[offset..]);
    offset += OperationIdRawSize;
    BinaryPrimitives.WriteUInt64LittleEndian(content[offset..], record.ServerSequence);
    offset += sizeof(ulong);
    BinaryPrimitives.WriteInt64LittleEndian(content[offset..], record.CommittedAt.UtcTicks);
    offset += sizeof(long);
    BinaryPrimitives.WriteInt32LittleEndian(content[offset..], actorIdLength);
    offset += sizeof(int);

    if (actorIdBytes is not null)
    {
      actorIdBytes.CopyTo(content[offset..]);
      offset += actorIdBytes.Length;
    }

    record.Digest.Span.CopyTo(content[offset..]);
    offset += DigestSize;
    BinaryPrimitives.WriteInt32LittleEndian(content[offset..], record.Update.Length);
    offset += sizeof(int);
    record.Update.Span.CopyTo(content[offset..]);
    offset += record.Update.Length;

    SHA256.HashData(content[..offset], content.Slice(offset, ChecksumSize));

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

    if (input.Length < LengthPrefixSize)
    {
      return CollabJournalRecordStatus.Incomplete;
    }

    var recordLength = BinaryPrimitives.ReadInt32LittleEndian(input);

    // Checked against the absolute ceiling BEFORE comparing to what remains:
    // a hostile or corrupted length must not be excused as "just needs more
    // bytes" by a coincidentally small remaining buffer, and this happens
    // before any slice or allocation sized by it.
    if (recordLength < MinRecordLength || recordLength > MaxRecordLength)
    {
      error = $"the record length {recordLength} is out of range";

      return CollabJournalRecordStatus.Invalid;
    }

    if (input.Length - LengthPrefixSize < recordLength)
    {
      return CollabJournalRecordStatus.Incomplete;
    }

    var content = input.Slice(LengthPrefixSize, recordLength);
    var contentToHash = content[..^ChecksumSize];
    var storedChecksum = content[^ChecksumSize..];

    // Verified before any field is parsed, so a corrupted CommittedAt or
    // Source fails closed here rather than throwing out of a field parser.
    Span<byte> computedChecksum = stackalloc byte[ChecksumSize];
    SHA256.HashData(contentToHash, computedChecksum);

    if (!computedChecksum.SequenceEqual(storedChecksum))
    {
      error = "the record checksum does not match its content";

      return CollabJournalRecordStatus.Invalid;
    }

    var offset = 0;
    var version = contentToHash[offset++];

    if (version != CurrentVersion)
    {
      error = $"unsupported codec version {version}";

      return CollabJournalRecordStatus.Invalid;
    }

    var sourceByte = contentToHash[offset++];
    var source = (CollabOperationSource)sourceByte;

    if (!Enum.IsDefined(source))
    {
      error = $"unknown operation source {sourceByte}";

      return CollabJournalRecordStatus.Invalid;
    }

    var operationId = Convert.ToHexStringLower(contentToHash.Slice(offset, OperationIdRawSize));
    offset += OperationIdRawSize;

    var serverSequence = BinaryPrimitives.ReadUInt64LittleEndian(contentToHash[offset..]);
    offset += sizeof(ulong);

    if (serverSequence < 1)
    {
      error = "server sequence 0 means nothing was committed on this lineage";

      return CollabJournalRecordStatus.Invalid;
    }

    var committedAtTicks = BinaryPrimitives.ReadInt64LittleEndian(contentToHash[offset..]);
    offset += sizeof(long);

    if (committedAtTicks < 0 || committedAtTicks > DateTimeOffset.MaxValue.Ticks)
    {
      error = "committedAt is out of range";

      return CollabJournalRecordStatus.Invalid;
    }

    var actorIdLength = BinaryPrimitives.ReadInt32LittleEndian(contentToHash[offset..]);
    offset += sizeof(int);

    if (actorIdLength is < -1 or > MaxActorIdLength || actorIdLength > contentToHash.Length - offset)
    {
      error = "the actor id length is invalid";

      return CollabJournalRecordStatus.Invalid;
    }

    string? actorId = null;

    if (actorIdLength >= 0)
    {
      try
      {
        actorId = Utf8.GetString(contentToHash.Slice(offset, actorIdLength));
      }
      catch (DecoderFallbackException)
      {
        error = "the actor id is not valid UTF-8";

        return CollabJournalRecordStatus.Invalid;
      }

      offset += actorIdLength;
    }

    if (contentToHash.Length - offset < DigestSize)
    {
      error = "the digest is truncated";

      return CollabJournalRecordStatus.Invalid;
    }

    var digest = contentToHash.Slice(offset, DigestSize).ToArray();
    offset += DigestSize;

    if (contentToHash.Length - offset < sizeof(int))
    {
      error = "the update length is missing";

      return CollabJournalRecordStatus.Invalid;
    }

    var updateLength = BinaryPrimitives.ReadInt32LittleEndian(contentToHash[offset..]);
    offset += sizeof(int);

    // Bound against the ceiling AND what actually remains: a checksum can be
    // honestly computed over bytes an attacker wrote directly, so passing it
    // does not by itself prove an inner length is safe to slice or allocate.
    if (updateLength < 1 || updateLength > MaxUpdateLength || updateLength > contentToHash.Length - offset)
    {
      error = "the update length is invalid";

      return CollabJournalRecordStatus.Invalid;
    }

    var update = contentToHash.Slice(offset, updateLength).ToArray();
    offset += updateLength;

    if (offset != contentToHash.Length)
    {
      error = $"{contentToHash.Length - offset} trailing byte(s) inside the record";

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
    consumed = LengthPrefixSize + recordLength;

    return CollabJournalRecordStatus.Ok;
  }
}
