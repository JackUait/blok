using System.Net;
using System.Security.Cryptography;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class S3BlobStoreObjectMethodsTests
{
  private const string Key = "collab/working-set-key";
  private const string ObjectPath = "/media/collab/working-set-key";

  [Fact]
  public async Task GetsAnObjectByItsKey()
  {
    var bucket = new FakeS3Bucket();
    bucket.Seed(ObjectPath, "stored bytes"u8.ToArray());
    using var store = S3CollabTestSupport.CreateS3BlobStore(bucket);

    var bytes = await store.GetObjectAsync(Key, CancellationToken.None);

    Assert.Equal("stored bytes"u8.ToArray(), bytes);
    var request = Assert.Single(bucket.Requests);
    Assert.Equal(ObjectPath, request.Path);
    Assert.Equal("s3.example.com", request.Headers["Host"]);
    Assert.Equal("20250102T030405Z", request.Headers["x-amz-date"]);
    Assert.Contains(
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        request.Headers["Authorization"],
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task GetTreatsOnlyNotFoundAsAbsent()
  {
    var bucket = new FakeS3Bucket();
    using var store = S3CollabTestSupport.CreateS3BlobStore(bucket);

    Assert.Null(await store.GetObjectAsync(Key, CancellationToken.None));
  }

  [Fact]
  public async Task GetThrowsOnForbidden()
  {
    // Real S3 answers 403 for a missing key without s3:ListBucket. That is
    // a credentials problem, never an absent working set — it must not be
    // silently turned into a re-seed.
    using var store = S3CollabTestSupport.CreateS3BlobStore(
        static (_, _) => Task.FromResult(
            new HttpResponseMessage(HttpStatusCode.Forbidden)));

    var error = await Assert.ThrowsAsync<HttpRequestException>(() =>
        store.GetObjectAsync(Key, CancellationToken.None));

    Assert.Equal(HttpStatusCode.Forbidden, error.StatusCode);
  }

  [Fact]
  public async Task PutsAnObjectWithItsHashAndOctetStreamType()
  {
    var bucket = new FakeS3Bucket();
    using var store = S3CollabTestSupport.CreateS3BlobStore(bucket);
    var content = "collab log bytes"u8.ToArray();

    await store.PutObjectAsync(Key, content, CancellationToken.None);

    Assert.Equal(content, bucket.StoredAt(ObjectPath));
    var request = Assert.Single(bucket.Requests);
    Assert.Equal(HttpMethod.Put, request.Method);
    Assert.Equal(
        "application/octet-stream",
        request.ContentHeaders["Content-Type"]);
    Assert.Equal(
        content.Length.ToString(
            System.Globalization.CultureInfo.InvariantCulture),
        request.ContentHeaders["Content-Length"]);
    Assert.Equal(
        Convert.ToHexStringLower(SHA256.HashData(content)),
        request.Headers["x-amz-content-sha256"]);
    Assert.Contains(
        "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
        request.Headers["Authorization"],
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task PutThrowsOnAnErrorStatus()
  {
    using var store = S3CollabTestSupport.CreateS3BlobStore(
        static (_, _) => Task.FromResult(
            new HttpResponseMessage(HttpStatusCode.InternalServerError)));

    var error = await Assert.ThrowsAsync<HttpRequestException>(() =>
        store.PutObjectAsync(Key, [0x01], CancellationToken.None));

    Assert.Equal(HttpStatusCode.InternalServerError, error.StatusCode);
  }

  [Fact]
  public async Task DeletesAnObjectByItsKey()
  {
    var bucket = new FakeS3Bucket();
    bucket.Seed(ObjectPath, [0x01]);
    using var store = S3CollabTestSupport.CreateS3BlobStore(bucket);

    await store.DeleteObjectAsync(Key, CancellationToken.None);

    Assert.False(bucket.Holds(ObjectPath));
    var request = Assert.Single(bucket.Requests);
    Assert.Equal(HttpMethod.Delete, request.Method);
    Assert.Equal(ObjectPath, request.Path);
    Assert.Contains("Authorization", request.Headers.Keys);
  }

  [Fact]
  public async Task RefusesAnEmptyKey()
  {
    using var store = S3CollabTestSupport.CreateS3BlobStore(
        new FakeS3Bucket());

    await Assert.ThrowsAsync<ArgumentException>(() =>
        store.GetObjectAsync("", CancellationToken.None));
    await Assert.ThrowsAsync<ArgumentException>(() =>
        store.PutObjectAsync("", [0x01], CancellationToken.None));
    await Assert.ThrowsAsync<ArgumentException>(() =>
        store.DeleteObjectAsync("", CancellationToken.None));
  }
}
