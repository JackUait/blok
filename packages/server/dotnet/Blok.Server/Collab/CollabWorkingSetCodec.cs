using System.Buffers.Binary;

namespace Blok.Server.Collab;

/// <summary>
/// Binary container for a persisted working set:
/// magic "BKWS" (4 bytes) + format (int32 LE) + epoch (int64 LE), then
/// zero or more frames, each an int32 LE length prefix (must be positive)
/// followed by that many bytes of one Yjs update.
/// </summary>
internal static class CollabWorkingSetCodec
{
  internal const int HeaderLength = 16;
  private const int FramePrefixLength = 4;

  private static ReadOnlySpan<byte> Magic => "BKWS"u8;

  internal static byte[] EncodeDocument(
      CollabWorkingSetTag tag,
      ReadOnlySpan<byte> frameSection)
  {
    if (tag.Format < 1 || tag.Epoch < 0)
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
    frameSection.CopyTo(document.AsSpan(HeaderLength));

    return document;
  }

  internal static bool TryDecodeDocument(
      ReadOnlySpan<byte> document,
      out CollabWorkingSetTag tag,
      out byte[] frameSection,
      out string error)
  {
    tag = default;
    frameSection = [];

    if (document.Length < HeaderLength)
    {
      error = "the header is truncated";

      return false;
    }

    if (!document[..Magic.Length].SequenceEqual(Magic))
    {
      error = "the magic bytes do not match";

      return false;
    }

    var format = BinaryPrimitives.ReadInt32LittleEndian(
        document[Magic.Length..]);
    var epoch = BinaryPrimitives.ReadInt64LittleEndian(
        document[(Magic.Length + sizeof(int))..]);

    if (format < 1 || epoch < 0)
    {
      error = $"the tag ({format}, {epoch}) is invalid";

      return false;
    }

    if (!TryDecodeFrames(document[HeaderLength..], out _))
    {
      error = "an update frame is empty or truncated";

      return false;
    }

    tag = new CollabWorkingSetTag(format, epoch);
    frameSection = document[HeaderLength..].ToArray();
    error = "";

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
