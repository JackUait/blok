using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Blok.Server.Collab;

/// <summary>What one lineage ledger entry records.</summary>
internal enum CollabLineageEntryKind : byte
{
  /// <summary>The generation was published as the document's lineage.</summary>
  Published = 1,

  /// <summary>The generation's files were deleted.</summary>
  Deleted = 2,
}

/// <summary>
/// One decoded lineage ledger entry. <c>CreatedAt</c> is null when the entry
/// was written for a lineage that began before the ledger existed.
/// </summary>
internal readonly record struct CollabLineageEntry(
    CollabLineageEntryKind Kind,
    ulong Generation,
    ulong GenerationFence,
    string Lineage,
    long Epoch,
    int Format,
    DateTimeOffset? CreatedAt);

/// <summary>
/// Encodes the <c>lineages</c> file in a document's journal directory.
/// </summary>
/// <remarks>
/// <para>
/// Layout of one entry, little-endian: kind (1), generation (8), generation
/// fence (8), lineage (16), epoch (8), format (4), created-at UTC ticks (8,
/// <see cref="long.MinValue"/> for unknown), then the first 8 bytes of a
/// SHA-256 over everything before them.
/// </para>
/// <para>
/// EVERY ENTRY IS THE SAME SIZE, and the reader steps by that size, so one bad
/// entry is skipped and the next still decodes. A writer that finds the file
/// off the grid (a torn append) pads up to it first; without that, one torn
/// tail would shift every later entry off the grid.
/// </para>
/// </remarks>
internal static class CollabLineageLedger
{
  internal const string FileName = "lineages";

  internal const int EntrySize = ContentSize + ChecksumSize;

  private const int ContentSize = 53;
  private const int ChecksumSize = 8;
  private const int LineageSize = 16;
  private const long UnknownTicks = long.MinValue;

  internal static byte[] Encode(CollabLineageEntry entry)
  {
    var bytes = new byte[EntrySize];
    var span = bytes.AsSpan();
    span[0] = (byte)entry.Kind;
    BinaryPrimitives.WriteUInt64LittleEndian(span[1..], entry.Generation);
    BinaryPrimitives.WriteUInt64LittleEndian(span[9..], entry.GenerationFence);
    Convert.FromHexString(entry.Lineage).CopyTo(span[17..]);
    BinaryPrimitives.WriteInt64LittleEndian(span[33..], entry.Epoch);
    BinaryPrimitives.WriteInt32LittleEndian(span[41..], entry.Format);
    BinaryPrimitives.WriteInt64LittleEndian(
        span[45..],
        entry.CreatedAt?.UtcTicks ?? UnknownTicks);
    WriteChecksum(span[..ContentSize], span[ContentSize..]);

    return bytes;
  }

  internal static bool TryDecode(ReadOnlySpan<byte> slot, out CollabLineageEntry entry)
  {
    entry = default;

    if (slot.Length != EntrySize)
    {
      return false;
    }

    Span<byte> computed = stackalloc byte[ChecksumSize];
    WriteChecksum(slot[..ContentSize], computed);

    if (!computed.SequenceEqual(slot[ContentSize..]))
    {
      return false;
    }

    var kind = (CollabLineageEntryKind)slot[0];

    if (!Enum.IsDefined(kind))
    {
      return false;
    }

    var ticks = BinaryPrimitives.ReadInt64LittleEndian(slot[45..]);

    if (ticks != UnknownTicks && (ticks < DateTime.MinValue.Ticks || ticks > DateTime.MaxValue.Ticks))
    {
      return false;
    }

    entry = new CollabLineageEntry(
        kind,
        BinaryPrimitives.ReadUInt64LittleEndian(slot[1..]),
        BinaryPrimitives.ReadUInt64LittleEndian(slot[9..]),
        Convert.ToHexStringLower(slot.Slice(17, LineageSize)),
        BinaryPrimitives.ReadInt64LittleEndian(slot[33..]),
        BinaryPrimitives.ReadInt32LittleEndian(slot[41..]),
        ticks == UnknownTicks ? null : new DateTimeOffset(ticks, TimeSpan.Zero));

    return true;
  }

  /// <summary>Every entry that decodes, in file order. A missing file is empty.</summary>
  internal static List<CollabLineageEntry> Read(string path, Action<string>? warn)
  {
    byte[] bytes;

    try
    {
      // Unlocked reads share everything, so on Windows they never block an
      // append or a purge's delete.
      using var file = new FileStream(
          path,
          FileMode.Open,
          FileAccess.Read,
          FileShare.ReadWrite | FileShare.Delete);
      bytes = new byte[file.Length];
      file.ReadExactly(bytes);
    }
    catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
    {
      return [];
    }

    var entries = new List<CollabLineageEntry>();
    var offset = 0;

    for (; offset + EntrySize <= bytes.Length; offset += EntrySize)
    {
      if (TryDecode(bytes.AsSpan(offset, EntrySize), out var entry))
      {
        entries.Add(entry);
      }
      else
      {
        warn?.Invoke($"collab: skipped a bad entry at byte {offset} of {path}.");
      }
    }

    if (offset < bytes.Length)
    {
      warn?.Invoke($"collab: skipped a torn entry at byte {offset} of {path}.");
    }

    return entries;
  }

  private static void WriteChecksum(ReadOnlySpan<byte> content, Span<byte> destination)
  {
    Span<byte> hash = stackalloc byte[SHA256.HashSizeInBytes];
    SHA256.HashData(content, hash);
    hash[..ChecksumSize].CopyTo(destination);
  }
}
