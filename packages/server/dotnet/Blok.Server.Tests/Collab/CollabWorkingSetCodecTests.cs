using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class CollabWorkingSetCodecTests
{
  private static readonly CollabWorkingSetTag Tag = new(
      CollabWorkingSetTag.SchemaV2,
      7);

  [Fact]
  public void RoundTripsAnEmptyLog()
  {
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, []);

    Assert.Equal(CollabWorkingSetCodec.HeaderLength, document.Length);
    Assert.True(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out var tag,
        out var frameSection,
        out _));
    Assert.Equal(Tag, tag);
    Assert.Empty(frameSection);
  }

  [Fact]
  public void RoundTripsUpdateFrames()
  {
    List<byte[]> updates =
    [
      [0x01],
      [0x00, 0xff, 0x10],
      "an update with text bytes"u8.ToArray(),
    ];
    var frameSection = CollabWorkingSetCodec.EncodeFrames(updates);
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, frameSection);

    Assert.True(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out var tag,
        out var decodedSection,
        out _));
    Assert.Equal(Tag, tag);
    Assert.True(CollabWorkingSetCodec.TryDecodeFrames(
        decodedSection,
        out var decodedUpdates));
    Assert.Equal(updates, decodedUpdates);
  }

  [Fact]
  public void EncodesTheDocumentedByteLayout()
  {
    var tag = new CollabWorkingSetTag(1, 0x0102030405060708);
    var frameSection = CollabWorkingSetCodec.EncodeFrames(
        [
          [0xaa, 0xbb],
        ]);

    var document = CollabWorkingSetCodec.EncodeDocument(tag, frameSection);

    Assert.Equal(
        new byte[]
        {
          0x42, 0x4b, 0x57, 0x53,
          0x01, 0x00, 0x00, 0x00,
          0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
          0x02, 0x00, 0x00, 0x00,
          0xaa, 0xbb,
        },
        document);
  }

  [Fact]
  public void PreservesExtremeTagValues()
  {
    var tag = new CollabWorkingSetTag(int.MaxValue, long.MaxValue);

    var document = CollabWorkingSetCodec.EncodeDocument(tag, []);

    Assert.True(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out var decoded,
        out _,
        out _));
    Assert.Equal(tag, decoded);
  }

  [Theory]
  [InlineData(0)]
  [InlineData(4)]
  [InlineData(15)]
  public void RejectsATruncatedHeader(int length)
  {
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, []);

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        document.AsSpan(0, length),
        out _,
        out _,
        out var error));
    Assert.NotEqual("", error);
  }

  [Fact]
  public void RejectsAWrongMagic()
  {
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, []);
    document[0] = (byte)'X';

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out _,
        out _,
        out _));
  }

  [Fact]
  public void RejectsANonPositiveFormat()
  {
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, []);
    document[4] = 0;

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out _,
        out _,
        out _));
  }

  [Fact]
  public void RejectsANegativeEpoch()
  {
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, []);
    document[15] = 0x80;

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out _,
        out _,
        out _));
  }

  [Fact]
  public void RejectsATruncatedFrame()
  {
    var frameSection = CollabWorkingSetCodec.EncodeFrames(
        [
          [0x01, 0x02, 0x03, 0x04],
        ]);
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, frameSection);

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        document.AsSpan(0, document.Length - 2),
        out _,
        out _,
        out _));
  }

  [Theory]
  [InlineData(1)]
  [InlineData(2)]
  [InlineData(3)]
  public void RejectsTrailingBytesThatCannotFormAFrame(int extra)
  {
    var document = CollabWorkingSetCodec.EncodeDocument(Tag, []);
    var padded = new byte[document.Length + extra];
    document.CopyTo(padded, 0);

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        padded,
        out _,
        out _,
        out _));
  }

  [Fact]
  public void RejectsANonPositiveFrameLength()
  {
    var document = new byte[CollabWorkingSetCodec.HeaderLength + 4];
    CollabWorkingSetCodec.EncodeDocument(Tag, []).CopyTo(document, 0);

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out _,
        out _,
        out _));
  }

  [Fact]
  public void RejectsAFrameLengthBeyondTheRemainingBytes()
  {
    var document = new byte[CollabWorkingSetCodec.HeaderLength + 5];
    CollabWorkingSetCodec.EncodeDocument(Tag, []).CopyTo(document, 0);
    document[CollabWorkingSetCodec.HeaderLength] = 0x7f;
    document[CollabWorkingSetCodec.HeaderLength + 3] = 0x7f;

    Assert.False(CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out _,
        out _,
        out _));
  }

  [Fact]
  public void RefusesToEncodeAnEmptyUpdateFrame()
  {
    Assert.Throws<ArgumentException>(() =>
        CollabWorkingSetCodec.EncodeFrames([[]]));
  }

  [Theory]
  [InlineData(0, 0L)]
  [InlineData(-1, 0L)]
  [InlineData(1, -1L)]
  public void RefusesToEncodeAnInvalidTag(int format, long epoch)
  {
    Assert.Throws<ArgumentException>(() =>
        CollabWorkingSetCodec.EncodeDocument(
            new CollabWorkingSetTag(format, epoch),
            []));
  }

  [Fact]
  public void RefusesToEncodeAnInvalidFrameSection()
  {
    Assert.Throws<ArgumentException>(() =>
        CollabWorkingSetCodec.EncodeDocument(
            Tag,
            [0x01, 0x02]));
  }
}
