using System.Security.Cryptography;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class S3CollabStoreTests
{
  private const string DocId = "doc-1";
  private const string ObjectPath =
      "/media/collab/" +
      "bb0e4f49443794d901e8969ff11bd112e34208a0dcdf0e1eedb480cc9b3c7293";
  private const string EmptyPayloadHash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  private static readonly CollabWorkingSetTag Tag = Tags.At(5);

  [Fact]
  public async Task ReadsAbsentAsNullThroughASignedGet()
  {
    var bucket = new FakeS3Bucket();
    var (store, logs) = CreateStore(bucket);

    Assert.Null(await store.ReadAsync(DocId, CancellationToken.None));

    var request = Assert.Single(bucket.Requests);
    Assert.Equal(HttpMethod.Get, request.Method);
    Assert.Equal(ObjectPath, request.Path);
    Assert.StartsWith(
        "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20250102/eu-central-1/",
        request.Headers["Authorization"],
        StringComparison.Ordinal);
    Assert.Contains(
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        request.Headers["Authorization"],
        StringComparison.Ordinal);
    Assert.Equal(
        EmptyPayloadHash,
        request.Headers["x-amz-content-sha256"]);
    Assert.Empty(logs);
  }

  [Fact]
  public async Task WritesThenReadsBackTheWorkingSet()
  {
    var bucket = new FakeS3Bucket();
    var (store, _) = CreateStore(bucket);
    var updates = CollabWorkingSetCodec.EncodeFrames(
        [
          [0x01, 0x02],
          [0x03],
        ]);

    await store.WriteAsync(DocId, updates, Tag, CancellationToken.None);

    // One PUT and nothing else: a guard GET before every write would double
    // the traffic of an edit, and the room owns the epoch law.
    Assert.Equal(
        new[] { HttpMethod.Put },
        bucket.Requests.Select(request => request.Method).ToArray());
    var put = bucket.Requests[^1];
    Assert.Equal(ObjectPath, put.Path);
    var expectedDocument = CollabWorkingSetCodec.EncodeDocument(
        Tag,
        updates);
    Assert.Equal(expectedDocument, put.Body);
    Assert.Equal(
        Convert.ToHexStringLower(SHA256.HashData(expectedDocument)),
        put.Headers["x-amz-content-sha256"]);

    var stored = await store.ReadAsync(DocId, CancellationToken.None);
    Assert.NotNull(stored);
    Assert.Equal(updates, stored.Updates);
    Assert.Equal(Tag, stored.Tag);
  }

  /// <summary>
  /// The epoch law lives in the room (one writer per doc, the tag it loaded,
  /// only a reset raises it). S3 cannot read a header cheaply, so this driver
  /// does not re-read the object per write — the belt-and-suspenders guard
  /// stays on the rare path, the reset.
  /// </summary>
  [Fact]
  public async Task WriteDoesNotReadTheObjectToGuardTheEpoch()
  {
    var bucket = new FakeS3Bucket();
    var (store, _) = CreateStore(bucket);
    bucket.Seed(
        ObjectPath,
        CollabWorkingSetCodec.EncodeDocument(Tag, []));

    await store.WriteAsync(
        DocId,
        [],
        Tag with { Epoch = Tag.Epoch - 1 },
        CancellationToken.None);

    Assert.Equal(
        new[] { HttpMethod.Put },
        bucket.Requests.Select(request => request.Method).ToArray());
  }

  [Fact]
  public async Task ResetRewritesToAnEmptyLogWithTheBumpedEpoch()
  {
    var bucket = new FakeS3Bucket();
    var (store, _) = CreateStore(bucket);
    bucket.Seed(
        ObjectPath,
        CollabWorkingSetCodec.EncodeDocument(
            Tag,
            CollabWorkingSetCodec.EncodeFrames([[0x01]])));

    var bumped = Tag with { Epoch = Tag.Epoch + 1 };
    await store.ResetAsync(DocId, bumped, CancellationToken.None);

    Assert.Equal(
        CollabWorkingSetCodec.EncodeDocument(bumped, []),
        bucket.StoredAt(ObjectPath));
  }

  [Fact]
  public async Task ResetRequiresAStrictlyHigherEpoch()
  {
    var bucket = new FakeS3Bucket();
    var (store, _) = CreateStore(bucket);
    bucket.Seed(
        ObjectPath,
        CollabWorkingSetCodec.EncodeDocument(Tag, []));

    await Assert.ThrowsAsync<InvalidOperationException>(() =>
        store.ResetAsync(DocId, Tag, CancellationToken.None));

    Assert.DoesNotContain(
        bucket.Requests,
        request => request.Method == HttpMethod.Put);
  }

  [Fact]
  public async Task TreatsACorruptObjectAsAbsentAndLogsIt()
  {
    var bucket = new FakeS3Bucket();
    var (store, logs) = CreateStore(bucket);
    bucket.Seed(ObjectPath, "not a working set"u8.ToArray());

    Assert.Null(await store.ReadAsync(DocId, CancellationToken.None));
    Assert.Contains(logs, entry => entry.Contains(DocId));

    // The epoch is lost with the object, so any epoch may re-seed it.
    await store.WriteAsync(
        DocId,
        [],
        Tag with { Epoch = 0 },
        CancellationToken.None);
    Assert.Equal(
        CollabWorkingSetCodec.EncodeDocument(Tag with { Epoch = 0 }, []),
        bucket.StoredAt(ObjectPath));
  }

  [Fact]
  public async Task TrimsSlashesAroundThePrefix()
  {
    var bucket = new FakeS3Bucket();
    var (store, _) = CreateStore(bucket, "/collab/");

    await store.ReadAsync(DocId, CancellationToken.None);

    Assert.Equal(ObjectPath, Assert.Single(bucket.Requests).Path);
  }

  [Theory]
  [InlineData("")]
  [InlineData("///")]
  public void RefusesAnEmptyPrefix(string prefix)
  {
    using var blobStore = S3CollabTestSupport.CreateS3BlobStore(
        new FakeS3Bucket());

    Assert.Throws<ArgumentException>(() =>
        new S3CollabStore(blobStore, prefix));
  }

  private static (S3CollabStore Store, List<string> Logs) CreateStore(
      FakeS3Bucket bucket,
      string prefix = "collab")
  {
    var logs = new List<string>();

    return (
        new S3CollabStore(
            S3CollabTestSupport.CreateS3BlobStore(bucket),
            prefix,
            logs.Add),
        logs);
  }
}
