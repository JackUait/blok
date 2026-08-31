using System.Net;
using Blok.Server.Storage;

namespace Blok.Server.Tests.Collab;

internal sealed record FakeS3Request(
    HttpMethod Method,
    string Path,
    IReadOnlyDictionary<string, string> Headers,
    IReadOnlyDictionary<string, string> ContentHeaders,
    byte[] Body);

/// <summary>In-memory bucket behind the injected handler.</summary>
internal sealed class FakeS3Bucket
{
  private readonly Dictionary<string, byte[]> objects = new(
      StringComparer.Ordinal);

  internal List<FakeS3Request> Requests { get; } = [];

  internal void Seed(string path, byte[] bytes)
  {
    objects[path] = bytes;
  }

  internal bool Holds(string path)
  {
    return objects.ContainsKey(path);
  }

  internal byte[] StoredAt(string path)
  {
    return objects[path];
  }

  internal async Task<HttpResponseMessage> HandleAsync(
      HttpRequestMessage request,
      CancellationToken cancellationToken)
  {
    var body = request.Content is null
      ? []
      : await request.Content.ReadAsByteArrayAsync(cancellationToken);
    var path = request.RequestUri?.AbsolutePath ?? "";
    Requests.Add(new FakeS3Request(
        request.Method,
        path,
        request.Headers.ToDictionary(
            header => header.Key,
            header => string.Join(", ", header.Value),
            StringComparer.OrdinalIgnoreCase),
        request.Content?.Headers.ToDictionary(
            header => header.Key,
            header => string.Join(", ", header.Value),
            StringComparer.OrdinalIgnoreCase) ??
            new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase),
        body));

    if (request.Method == HttpMethod.Get)
    {
      return objects.TryGetValue(path, out var stored)
        ? new HttpResponseMessage(HttpStatusCode.OK)
        {
          Content = new ByteArrayContent(stored),
        }
        : new HttpResponseMessage(HttpStatusCode.NotFound)
        {
          Content = new StringContent(
              "<Error><Code>NoSuchKey</Code></Error>"),
        };
    }

    if (request.Method == HttpMethod.Put)
    {
      objects[path] = body;

      return new HttpResponseMessage(HttpStatusCode.OK);
    }

    if (request.Method == HttpMethod.Delete)
    {
      objects.Remove(path);

      return new HttpResponseMessage(HttpStatusCode.NoContent);
    }

    return new HttpResponseMessage(HttpStatusCode.MethodNotAllowed);
  }
}

internal static class S3CollabTestSupport
{
  internal static readonly DateTimeOffset FrozenTime =
      new(2025, 1, 2, 3, 4, 5, TimeSpan.Zero);

  internal static S3BlobStore CreateS3BlobStore(FakeS3Bucket bucket)
  {
    return CreateS3BlobStore(bucket.HandleAsync);
  }

  internal static S3BlobStore CreateS3BlobStore(
      Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send)
  {
    return new S3BlobStore(
        new S3BlobStoreOptions(
            "https://s3.example.com",
            "eu-central-1",
            "media",
            "AKIAEXAMPLE",
            "wJalrXUtnFEMI/K7MDENG",
            "https://cdn.example.com/media",
            "path",
            1024,
            Path.GetTempPath()),
        new CollabDelegateHandler(send),
        new CollabFrozenTimeProvider(FrozenTime));
  }

  private sealed class CollabDelegateHandler(
      Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) :
      HttpMessageHandler
  {
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
      return send(request, cancellationToken);
    }
  }

  private sealed class CollabFrozenTimeProvider(DateTimeOffset utcNow) :
      TimeProvider
  {
    public override DateTimeOffset GetUtcNow()
    {
      return utcNow;
    }
  }
}
