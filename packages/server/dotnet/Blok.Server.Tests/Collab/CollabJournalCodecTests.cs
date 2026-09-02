using System.Buffers.Binary;
using System.Security.Cryptography;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class CollabJournalCodecTests
{
  private const string OperationId = "0123456789abcdef0123456789abcdef";
  private static readonly DateTimeOffset CommittedAt = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);

  [Fact]
  public void RoundTripsEveryRecordField()
  {
    var record = MakeRecord(update: [0x01, 0x02, 0x03], actorId: "actor-1");

    var encoded = CollabJournalCodec.EncodeRecord(record);
    var status = CollabJournalCodec.TryDecodeRecord(encoded, out var decoded, out var consumed, out var error);

    Assert.Equal(CollabJournalRecordStatus.Ok, status);
    Assert.Equal("", error);
    Assert.Equal(encoded.Length, consumed);
    Assert.NotNull(decoded);
    Assert.Equal(record.OperationId, decoded!.OperationId);
    Assert.Equal(record.ServerSequence, decoded.ServerSequence);
    Assert.Equal(record.CommittedAt, decoded.CommittedAt);
    Assert.Equal(record.ActorId, decoded.ActorId);
    Assert.Equal(record.Source, decoded.Source);
    Assert.Equal(record.Update.ToArray(), decoded.Update.ToArray());
    Assert.Equal(record.Digest.ToArray(), decoded.Digest.ToArray());
  }

  [Fact]
  public void RejectsOversizedLengthsBeforeAllocating()
  {
    // The outer record length is a hostile absolute value; only a handful of
    // bytes follow it. Must be rejected without trying to read/allocate that many bytes.
    var hostileOuterLength = new byte[LengthPrefixSize + 10];
    BinaryPrimitives.WriteInt32LittleEndian(hostileOuterLength, int.MaxValue);

    var outerStatus = CollabJournalCodec.TryDecodeRecord(
        hostileOuterLength,
        out var outerRecord,
        out var outerConsumed,
        out var outerError);

    Assert.Equal(CollabJournalRecordStatus.Invalid, outerStatus);
    Assert.Null(outerRecord);
    Assert.Equal(0, outerConsumed);
    // Pins WHICH check fired, not just that some check did: a misaligned
    // hand-built attack buffer could trip an earlier, unrelated check and
    // still report Invalid without ever reaching the length comparison.
    Assert.Contains("record length", outerError);

    // The outer length is honest and small, and the checksum is genuinely
    // computed over what is present — but the inner update length claims far
    // more bytes than actually remain before the checksum trailer. A codec
    // that trusted this length before checking it against the remaining
    // bytes would try to slice/allocate 1,000,000 bytes that are not there.
    var innerAttack = BuildRecordWithLyingUpdateLength(declaredUpdateLength: 1_000_000, actualUpdateBytes: 3);

    var innerStatus = CollabJournalCodec.TryDecodeRecord(
        innerAttack,
        out var innerRecord,
        out var innerConsumed,
        out var innerError);

    Assert.Equal(CollabJournalRecordStatus.Invalid, innerStatus);
    Assert.Null(innerRecord);
    Assert.Equal(0, innerConsumed);
    // Confirms the update-length check itself fired (not some earlier field
    // check), which also proves the hand-built layout above lines up with
    // the codec's own parser.
    Assert.Contains("update length", innerError);
  }

  [Fact]
  public void RejectsInvalidIdsAndSequences()
  {
    Assert.Throws<ArgumentException>(() =>
        CollabJournalCodec.EncodeRecord(MakeRecord(operationId: "too-short-to-be-an-id")));
    Assert.Throws<ArgumentException>(() =>
        CollabJournalCodec.EncodeRecord(MakeRecord(operationId: new string('A', 32))));
    Assert.Throws<ArgumentException>(() =>
        CollabJournalCodec.EncodeRecord(MakeRecord(serverSequence: 0)));
  }

  [Fact]
  public void DetectsPayloadDigestMismatch()
  {
    var digest = SHA256.HashData([0xaa, 0xbb, 0xcc]);
    var record = MakeRecord(update: [0xaa, 0xbb, 0xcc], digest: digest);
    var encoded = CollabJournalCodec.EncodeRecord(record);

    var digestOffset = IndexOfSequence(encoded, digest);
    var corrupted = (byte[])encoded.Clone();
    corrupted[digestOffset] ^= 0xFF;

    var status = CollabJournalCodec.TryDecodeRecord(corrupted, out var decoded, out _, out var error);

    Assert.Equal(CollabJournalRecordStatus.Invalid, status);
    Assert.Null(decoded);
    Assert.NotEqual("", error);
  }

  [Fact]
  public void HttpEditDigestCoversTheCanonicalBodyNotTheUpdate()
  {
    // The update bytes embed the room's randomly-assigned Yjs client id, so
    // they differ on every room instance for the same logical edit. The
    // digest must cover the canonical HTTP body instead, or retrying the
    // same edit against a recreated room could never dedupe.
    var update = "yjs-update-with-random-client-id"u8.ToArray();
    var canonicalBody = "{\"blockId\":\"b1\",\"data\":{\"text\":\"hi\"}}"u8.ToArray();
    var canonicalDigest = SHA256.HashData(canonicalBody);
    var updateDigest = SHA256.HashData(update);

    var record = MakeRecord(source: CollabOperationSource.HttpEdit, update: update, digest: canonicalDigest);
    var encoded = CollabJournalCodec.EncodeRecord(record);
    var status = CollabJournalCodec.TryDecodeRecord(encoded, out var decoded, out _, out _);

    Assert.Equal(CollabJournalRecordStatus.Ok, status);
    Assert.Equal(canonicalDigest, decoded!.Digest.ToArray());
    Assert.NotEqual(updateDigest, decoded.Digest.ToArray());
  }

  [Fact]
  public void RecognizesOnlyAnIncompleteFinalRecordAsTorn()
  {
    var first = CollabJournalCodec.EncodeRecord(MakeRecord(serverSequence: 1));
    var second = CollabJournalCodec.EncodeRecord(MakeRecord(serverSequence: 2));
    var third = CollabJournalCodec.EncodeRecord(MakeRecord(serverSequence: 3));

    // Simulates a crash mid-append: the third record's write never finished.
    var journal = Concat(first, second, third.AsSpan(0, third.Length / 2).ToArray());

    var position = 0;
    var statusFirst = CollabJournalCodec.TryDecodeRecord(
        journal.AsSpan(position), out var recordFirst, out var consumedFirst, out _);
    position += consumedFirst;
    var statusSecond = CollabJournalCodec.TryDecodeRecord(
        journal.AsSpan(position), out var recordSecond, out var consumedSecond, out _);
    position += consumedSecond;
    var statusThird = CollabJournalCodec.TryDecodeRecord(
        journal.AsSpan(position), out var recordThird, out var consumedThird, out _);

    Assert.Equal(CollabJournalRecordStatus.Ok, statusFirst);
    Assert.Equal(1UL, recordFirst!.ServerSequence);
    Assert.Equal(CollabJournalRecordStatus.Ok, statusSecond);
    Assert.Equal(2UL, recordSecond!.ServerSequence);

    // The dangling tail is recoverable, not corruption: nothing acknowledged
    // was ever written past this point, so truncating it loses nothing.
    Assert.Equal(CollabJournalRecordStatus.Incomplete, statusThird);
    Assert.Null(recordThird);
    Assert.Equal(0, consumedThird);
  }

  [Fact]
  public void FailsClosedOnMiddleCorruption()
  {
    var first = CollabJournalCodec.EncodeRecord(MakeRecord(serverSequence: 1));
    var second = CollabJournalCodec.EncodeRecord(MakeRecord(serverSequence: 2));
    var journal = Concat(first, second);

    // Flip a byte inside the first record's operationId field (a different
    // region than DetectsPayloadDigestMismatch touches), well before its own
    // checksum trailer. The file is not truncated: the second record is
    // still fully and correctly present right after it.
    journal[LengthPrefixSize + 2] ^= 0xFF;

    var statusFirst = CollabJournalCodec.TryDecodeRecord(
        journal.AsSpan(0), out var recordFirst, out _, out var error);

    // Invalid, never Incomplete: an Incomplete verdict would invite a store
    // to truncate here, which would silently discard the good record that
    // follows. Only a full refusal is safe once bytes are simply wrong.
    Assert.Equal(CollabJournalRecordStatus.Invalid, statusFirst);
    Assert.Null(recordFirst);
    Assert.NotEqual("", error);

    // The second record, read from its own (untouched) position, is proof
    // the corruption is confined to the middle record and not a length that
    // walked off the rails — which is exactly what a naive "skip and keep
    // going" reader would be tempted to exploit, and exactly what fail-closed forbids.
    var statusSecond = CollabJournalCodec.TryDecodeRecord(
        journal.AsSpan(first.Length), out var recordSecond, out _, out _);

    Assert.Equal(CollabJournalRecordStatus.Ok, statusSecond);
    Assert.Equal(2UL, recordSecond!.ServerSequence);
  }

  [Fact]
  public void PreservesUnknownActorAsNull()
  {
    var record = MakeRecord(actorId: null);

    var encoded = CollabJournalCodec.EncodeRecord(record);
    var status = CollabJournalCodec.TryDecodeRecord(encoded, out var decoded, out _, out _);

    Assert.Equal(CollabJournalRecordStatus.Ok, status);
    Assert.Null(decoded!.ActorId);
  }

  private const int LengthPrefixSize = sizeof(int);
  private const int DigestSize = 32;
  private const int ChecksumSize = 32;

  private static CollabOperationRecord MakeRecord(
      string operationId = OperationId,
      ulong serverSequence = 1,
      string? actorId = "actor-1",
      CollabOperationSource source = CollabOperationSource.ClientV2,
      byte[]? update = null,
      byte[]? digest = null)
  {
    update ??= [0x01, 0x02, 0x03];
    digest ??= SHA256.HashData(update);

    return new CollabOperationRecord(
        operationId,
        serverSequence,
        CommittedAt,
        actorId,
        source,
        update,
        digest);
  }

  private static byte[] Concat(params byte[][] parts)
  {
    var result = new byte[parts.Sum(part => part.Length)];
    var offset = 0;

    foreach (var part in parts)
    {
      part.CopyTo(result, offset);
      offset += part.Length;
    }

    return result;
  }

  private static int IndexOfSequence(byte[] haystack, byte[] needle)
  {
    for (var index = 0; index <= haystack.Length - needle.Length; index++)
    {
      if (haystack.AsSpan(index, needle.Length).SequenceEqual(needle))
      {
        return index;
      }
    }

    throw new InvalidOperationException("collab test: the needle was not found in the haystack.");
  }

  /// <summary>
  /// Hand-assembles a record whose checksum is honestly computed over the
  /// bytes actually present, but whose inner update-length field lies about
  /// how many update bytes follow. This is what EncodeRecord can never
  /// produce (it always writes a consistent length) but what bytes written
  /// directly to disk by a hostile actor could.
  /// </summary>
  private static byte[] BuildRecordWithLyingUpdateLength(int declaredUpdateLength, int actualUpdateBytes)
  {
    const int fixedContentSize = 1 + 1 + 16 + sizeof(ulong) + sizeof(long) + sizeof(int) + DigestSize + sizeof(int);
    var contentToHashLength = fixedContentSize + actualUpdateBytes;
    var contentToHash = new byte[contentToHashLength];
    var offset = 0;

    contentToHash[offset++] = CollabJournalCodec.CurrentVersion;
    contentToHash[offset++] = (byte)CollabOperationSource.ClientV2;
    Convert.FromHexString(OperationId).CopyTo(contentToHash, offset);
    offset += 16;
    BinaryPrimitives.WriteUInt64LittleEndian(contentToHash.AsSpan(offset), 1);
    offset += sizeof(ulong);
    BinaryPrimitives.WriteInt64LittleEndian(contentToHash.AsSpan(offset), CommittedAt.UtcTicks);
    offset += sizeof(long);
    BinaryPrimitives.WriteInt32LittleEndian(contentToHash.AsSpan(offset), -1); // no actor
    offset += sizeof(int);
    new byte[DigestSize].CopyTo(contentToHash, offset); // digest content is irrelevant to this attack
    offset += DigestSize;
    BinaryPrimitives.WriteInt32LittleEndian(contentToHash.AsSpan(offset), declaredUpdateLength); // the lie
    offset += sizeof(int);

    for (var index = 0; index < actualUpdateBytes; index++)
    {
      contentToHash[offset + index] = (byte)(0xC0 + index);
    }

    var checksum = SHA256.HashData(contentToHash);
    var content = Concat(contentToHash, checksum);
    var recordLength = content.Length;
    var buffer = new byte[LengthPrefixSize + recordLength];

    BinaryPrimitives.WriteInt32LittleEndian(buffer, recordLength);
    content.CopyTo(buffer, LengthPrefixSize);

    return buffer;
  }
}
