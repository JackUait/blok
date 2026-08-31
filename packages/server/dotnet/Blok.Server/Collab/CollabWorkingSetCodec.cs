using System.Buffers.Binary;

namespace Blok.Server.Collab;

/// <summary>
/// Binary container for a persisted working set:
/// magic "BKW2" (4 bytes) + format (int32 LE) + epoch (int64 LE) + lineage
/// (16 raw bytes), then zero or more frames, each an int32 LE length prefix
/// (must be positive) followed by that many bytes of one Yjs update.
///
/// The magic carries the container version: "BKWS" was the pre-lineage
/// header, and a blob still carrying it decodes as unreadable, which the
/// store reports as absent and the doc re-seeds under a new lineage. That is
/// the migration — the format never shipped.
/// </summary>
internal static class CollabWorkingSetCodec
{
  internal const int HeaderLength = 32;
  private const int FramePrefixLength = 4;
  private const int LineageLength = CollabWorkingSetTag.LineageLength / 2;
  private const int LineageOffset = 16;

  private static ReadOnlySpan<byte> Magic => "BKW2"u8;

  internal static byte[] EncodeDocument(
      CollabWorkingSetTag tag,
      ReadOnlySpan<byte> frameSection)
  {
    if (!tag.IsAnnounceable())
    {
      throw new ArgumentException(
          $"collab: the tag {tag} is not encodable.",
          nameof(tag));
    }

    if (!TryDecodeFrames(frameSection, out _))
    {
      throw new ArgumentException(
          "collab: the frame section is not a valid update log.",
          nameof(frameSection));
    }

    var document = new byte[HeaderLength + frameSection.Length];
    Magic.CopyTo(document);
    BinaryPrimitives.WriteInt32LittleEndian(
        document.AsSpan(Magic.Length),
        tag.Format);
    BinaryPrimitives.WriteInt64LittleEndian(
        document.AsSpan(Magic.Length + sizeof(int)),
        tag.Epoch);
    Convert.FromHexString(tag.Lineage).CopyTo(document.AsSpan(LineageOffset));
    frameSection.CopyTo(document.AsSpan(HeaderLength));

    return document;
  }

  /// <summary>Reads just the header, so a guard does not have to read the whole log.</summary>
  internal static bool TryDecodeHeader(
      ReadOnlySpan<byte> header,
      out CollabWorkingSetTag tag,
      out string error)
  {
    tag = default;

    if (header.Length < HeaderLength)
    {
      error = "the header is truncated";

      return false;
    }

    if (!header[..Magic.Length].SequenceEqual(Magic))
    {
      error = "the magic bytes do not match";

      return false;
    }

    var format = BinaryPrimitives.ReadInt32LittleEndian(
        header[Magic.Length..]);
    var epoch = BinaryPrimitives.ReadInt64LittleEndian(
        header[(Magic.Length + sizeof(int))..]);
    var lineage = Convert.ToHexStringLower(
        header.Slice(LineageOffset, LineageLength));

    if (format < 1 || epoch < 0)
    {
      error = $"the tag ({format}, {epoch}) is invalid";

      return false;
    }

    tag = new CollabWorkingSetTag(format, epoch, lineage);
    error = "";

    return true;
  }

  internal static bool TryDecodeDocument(
      ReadOnlySpan<byte> document,
      out CollabWorkingSetTag tag,
      out byte[] frameSection,
      out string error)
  {
    frameSection = [];

    if (!TryDecodeHeader(document, out tag, out error))
    {
      return false;
    }

    if (!TryDecodeFrames(document[HeaderLength..], out _))
    {
      tag = default;
      error = "an update frame is empty or truncated";

      return false;
    }

    frameSection = document[HeaderLength..].ToArray();

    return true;
  }

  internal static byte[] EncodeFrames(IReadOnlyList<byte[]> updates)
  {
    ArgumentNullException.ThrowIfNull(updates);

    var length = 0L;

    foreach (var update in updates)
    {
      ArgumentNullException.ThrowIfNull(update, nameof(updates));

      if (update.Length == 0)
      {
        throw new ArgumentException(
            "collab: update frames must not be empty.",
            nameof(updates));
      }

      length += FramePrefixLength + (long)update.Length;
    }

    var frameSection = new byte[length];
    var offset = 0;

    foreach (var update in updates)
    {
      BinaryPrimitives.WriteInt32LittleEndian(
          frameSection.AsSpan(offset),
          update.Length);
      update.CopyTo(frameSection.AsSpan(offset + FramePrefixLength));
      offset += FramePrefixLength + update.Length;
    }

    return frameSection;
  }

  internal static bool TryDecodeFrames(
      ReadOnlySpan<byte> frameSection,
      out List<byte[]> updates)
  {
    updates = [];

    while (frameSection.Length > 0)
    {
      if (frameSection.Length < FramePrefixLength)
      {
        return false;
      }

      var length = BinaryPrimitives.ReadInt32LittleEndian(frameSection);

      if (length < 1 ||
          length > frameSection.Length - FramePrefixLength)
      {
        return false;
      }

      updates.Add(frameSection.Slice(FramePrefixLength, length).ToArray());
      frameSection = frameSection[(FramePrefixLength + length)..];
    }

    return true;
  }
}
