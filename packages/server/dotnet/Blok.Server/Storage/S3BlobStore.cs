using System.Buffers;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace Blok.Server.Storage;

internal sealed class S3BlobStore : IBlobStore, IDisposable
{
  private const int CopyBufferSize = 81920;
  private const int ErrorBodyLimit = 512;
  private static readonly TimeSpan DefaultRequestTimeout =
      TimeSpan.FromMinutes(5);
  private static readonly TimeSpan DefaultResponseHeaderTimeout =
      TimeSpan.FromSeconds(60);
  private static readonly string EmptyPayloadHash =
      S3RequestSigner.Sha256Hex([]);

  private readonly S3BlobStoreOptions options;
  private readonly HttpClient client;
  private readonly TimeProvider timeProvider;

  internal S3BlobStore(
      S3BlobStoreOptions options,
      TimeProvider timeProvider) :
      this(options, CreateHandler(), timeProvider)
  {
  }

  internal S3BlobStore(
      S3BlobStoreOptions options,
      HttpMessageHandler handler,
      TimeProvider timeProvider)
  {
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(handler);
    ArgumentNullException.ThrowIfNull(timeProvider);
    S3TargetResolver.Resolve(options, "validation");

    this.options = options;
    this.timeProvider = timeProvider;

    // This client may reach only the operator-configured S3 endpoint.
    // Consumer-supplied URLs belong to the guarded fetch path.
    client = new HttpClient(handler, disposeHandler: true)
    {
      Timeout = Timeout.InfiniteTimeSpan,
    };
  }

  public async Task<string> PutAsync(
      string extension,
      string mimeType,
      Stream content,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(extension);
    ArgumentNullException.ThrowIfNull(mimeType);
    ArgumentNullException.ThrowIfNull(content);
    cancellationToken.ThrowIfCancellationRequested();

    var key = BlobKey.Create(extension);
    await using var payload = await PreparedPayload.CreateAsync(
        content,
        options.MaximumSpoolBytes,
        options.TemporaryDirectory,
        cancellationToken);
    await SendAsync(
        HttpMethod.Put,
        key,
        SanitizeMediaType(mimeType),
        payload.Content,
        payload.Length,
        payload.Hash,
        cancellationToken);

    return $"{options.PublicUrl.TrimEnd('/')}/{key}";
  }

  public Task DeleteAsync(
      string url,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(url);
    cancellationToken.ThrowIfCancellationRequested();

    if (!BlobKey.TryParsePublicUrl(
          options.PublicUrl,
          url,
          out var key))
    {
      throw new ForeignBlobUrlException(url);
    }

    return SendAsync(
        HttpMethod.Delete,
        key,
        "",
        Stream.Null,
        0,
        EmptyPayloadHash,
        cancellationToken);
  }

  public void Dispose()
  {
    client.Dispose();
  }

  private async Task SendAsync(
      HttpMethod method,
      string key,
      string mimeType,
      Stream content,
      long contentLength,
      string payloadHash,
      CancellationToken cancellationToken)
  {
    var target = S3TargetResolver.Resolve(options, key);
    using var requestCancellation =
        CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken);
    requestCancellation.CancelAfter(
        options.RequestTimeout > TimeSpan.Zero
          ? options.RequestTimeout
          : DefaultRequestTimeout);
    using var responseHeaderCancellation =
        CancellationTokenSource.CreateLinkedTokenSource(
            requestCancellation.Token);
    var responseHeaderTimeout = options.ResponseHeaderTimeout > TimeSpan.Zero
      ? options.ResponseHeaderTimeout
      : DefaultResponseHeaderTimeout;
    using var request = new HttpRequestMessage(method, target.Url)
    {
      Content = new PayloadContent(
          content,
          contentLength,
          () => responseHeaderCancellation.CancelAfter(
              responseHeaderTimeout)),
    };

    if (mimeType != "")
    {
      request.Content.Headers.TryAddWithoutValidation(
          "Content-Type",
          mimeType);
      request.Content.Headers.ContentDisposition =
          new ContentDispositionHeaderValue("attachment");
    }

    S3RequestSigner.Sign(
        request,
        target,
        options,
        payloadHash,
        timeProvider.GetUtcNow());

    using var response = await client.SendAsync(
        request,
        HttpCompletionOption.ResponseHeadersRead,
        responseHeaderCancellation.Token);
    responseHeaderCancellation.CancelAfter(
        Timeout.InfiniteTimeSpan);
    if (response.IsSuccessStatusCode)
    {
      return;
    }

    var responseBody = await ReadResponsePrefixAsync(
        response,
        requestCancellation.Token);
    throw new HttpRequestException(
        $"blobstore: s3 {method.Method} returned " +
        $"{(int)response.StatusCode}: " +
        Encoding.UTF8.GetString(responseBody).Trim(),
        inner: null,
        response.StatusCode);
  }

  private static SocketsHttpHandler CreateHandler()
  {
    return new SocketsHttpHandler
    {
      AllowAutoRedirect = false,
      ConnectTimeout = TimeSpan.FromSeconds(10),
    };
  }

  private static async Task<byte[]> ReadResponsePrefixAsync(
      HttpResponseMessage response,
      CancellationToken cancellationToken)
  {
    if (response.Content is null)
    {
      return [];
    }

    Stream body;

    try
    {
      body = await response.Content.ReadAsStreamAsync(
          cancellationToken);
    }
    catch (Exception error) when (
        error is not OperationCanceledException)
    {
      cancellationToken.ThrowIfCancellationRequested();

      return [];
    }

    await using (body)
    {
      var buffer = new byte[ErrorBodyLimit];
      var total = 0;

      try
      {
        while (total < buffer.Length)
        {
          var read = await body.ReadAsync(
              buffer.AsMemory(total),
              cancellationToken);

          if (read == 0)
          {
            break;
          }

          total += read;
        }
      }
      catch (Exception error) when (
          error is not OperationCanceledException)
      {
        cancellationToken.ThrowIfCancellationRequested();
      }

      return total == buffer.Length
        ? buffer
        : buffer[..total];
    }
  }

  private static string SanitizeMediaType(string value)
  {
    value = value.Trim();

    if (value == "" ||
        value.Length > 255 ||
        !IsAscii(value) ||
        !MediaTypeHeaderValue.TryParse(value, out var mediaType) ||
        HasConflictingParameters(mediaType))
    {
      return "";
    }

    return value;
  }

  private static bool HasConflictingParameters(
      MediaTypeHeaderValue mediaType)
  {
    var values = new Dictionary<string, string>(
        StringComparer.OrdinalIgnoreCase);

    foreach (var parameter in mediaType.Parameters)
    {
      var value = UnquoteMediaParameter(parameter.Value);

      if (values.TryGetValue(parameter.Name, out var existing) &&
          existing != value)
      {
        return true;
      }

      values[parameter.Name] = value;
    }

    return false;
  }

  private static string UnquoteMediaParameter(string? value)
  {
    if (value is null ||
        value.Length < 2 ||
        value[0] != '"' ||
        value[^1] != '"')
    {
      return value ?? "";
    }

    value = value[1..^1];
    var result = new StringBuilder(value.Length);

    for (var index = 0; index < value.Length; index++)
    {
      if (value[index] == '\\' &&
          index + 1 < value.Length &&
          IsMimeSpecial(value[index + 1]))
      {
        index++;
      }

      result.Append(value[index]);
    }

    return result.ToString();
  }

  private static bool IsMimeSpecial(char value)
  {
    return value is '(' or ')' or '<' or '>' or '@' or ',' or ';' or ':' or
        '\\' or '"' or '/' or '[' or ']' or '?' or '=';
  }

  private static bool IsAscii(string value)
  {
    foreach (var character in value)
    {
      if (character is < (char)0x20 or > (char)0x7e)
      {
        return false;
      }
    }

    return true;
  }

  private sealed class PreparedPayload(
      Stream content,
      long length,
      string hash,
      string? temporaryPath) : IAsyncDisposable
  {
    internal Stream Content { get; } = content;

    internal long Length { get; } = length;

    internal string Hash { get; } = hash;

    internal static async Task<PreparedPayload> CreateAsync(
        Stream content,
        long maximumSpoolBytes,
        string temporaryDirectory,
        CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();

      if (content.CanSeek)
      {
        long start;

        try
        {
          start = content.Seek(0, SeekOrigin.Current);
        }
        catch (Exception error) when (
            error is IOException or NotSupportedException)
        {
          return await CreateSpooledAsync(
              content,
              maximumSpoolBytes,
              temporaryDirectory,
              cancellationToken);
        }

        return await CreateSeekableAsync(
            content,
            start,
            cancellationToken);
      }

      return await CreateSpooledAsync(
          content,
          maximumSpoolBytes,
          temporaryDirectory,
          cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
      if (temporaryPath is null)
      {
        return;
      }

      try
      {
        await Content.DisposeAsync();
      }
      finally
      {
        File.Delete(temporaryPath);
      }
    }

    private static async Task<PreparedPayload> CreateSeekableAsync(
        Stream content,
        long start,
        CancellationToken cancellationToken)
    {
      var end = content.Seek(0, SeekOrigin.End);
      content.Seek(start, SeekOrigin.Begin);

      if (end < start)
      {
        throw new IOException(
            "The S3 payload stream ends before its current position.");
      }

      byte[] hash;

      try
      {
        hash = await SHA256.HashDataAsync(
            content,
            cancellationToken);
      }
      finally
      {
        content.Seek(start, SeekOrigin.Begin);
      }

      return new PreparedPayload(
          content,
          end - start,
          Convert.ToHexStringLower(hash),
          temporaryPath: null);
    }

    private static async Task<PreparedPayload> CreateSpooledAsync(
        Stream content,
        long maximumSpoolBytes,
        string temporaryDirectory,
        CancellationToken cancellationToken)
    {
      if (maximumSpoolBytes <= 0)
      {
        throw new InvalidOperationException(
            "The S3 spool limit must be positive.");
      }

      Directory.CreateDirectory(temporaryDirectory);
      var path = Path.Combine(
          temporaryDirectory,
          $"blok-s3-{Guid.NewGuid():N}.tmp");
      var fileOptions = new FileStreamOptions
      {
        Access = FileAccess.ReadWrite,
        BufferSize = CopyBufferSize,
        Mode = FileMode.CreateNew,
        Options = FileOptions.Asynchronous |
            FileOptions.SequentialScan |
            FileOptions.DeleteOnClose,
        Share = FileShare.None,
      };

      if (!OperatingSystem.IsWindows())
      {
        fileOptions.UnixCreateMode =
            UnixFileMode.UserRead | UnixFileMode.UserWrite;
      }

      var file = new FileStream(path, fileOptions);
      var buffer = ArrayPool<byte>.Shared.Rent(CopyBufferSize);

      try
      {
        using var hash = IncrementalHash.CreateHash(
            HashAlgorithmName.SHA256);
        long total = 0;

        while (true)
        {
          cancellationToken.ThrowIfCancellationRequested();
          var remaining = maximumSpoolBytes - total;
          var readLimit = remaining >= buffer.Length
            ? buffer.Length
            : checked((int)remaining + 1);
          var read = await content.ReadAsync(
              buffer.AsMemory(0, readLimit),
              cancellationToken);

          if (read == 0)
          {
            break;
          }

          if (read > remaining)
          {
            throw new IOException(
                $"The S3 payload exceeds the configured " +
                $"{maximumSpoolBytes}-byte limit.");
          }

          await file.WriteAsync(
              buffer.AsMemory(0, read),
              cancellationToken);
          hash.AppendData(buffer, 0, read);
          total += read;
        }

        await file.FlushAsync(cancellationToken);
        file.Position = 0;

        return new PreparedPayload(
            file,
            total,
            Convert.ToHexStringLower(hash.GetHashAndReset()),
            path);
      }
      catch
      {
        try
        {
          await file.DisposeAsync();
        }
        finally
        {
          File.Delete(path);
        }

        throw;
      }
      finally
      {
        ArrayPool<byte>.Shared.Return(buffer);
      }
    }
  }

  private sealed class PayloadContent : HttpContent
  {
    private readonly Stream content;
    private readonly Action serializationCompleted;

    internal PayloadContent(
        Stream content,
        long length,
        Action serializationCompleted)
    {
      this.content = content;
      this.serializationCompleted = serializationCompleted;
      Headers.ContentLength = length;
    }

    protected override async Task SerializeToStreamAsync(
        Stream stream,
        TransportContext? context)
    {
      await content.CopyToAsync(stream);
      serializationCompleted();
    }

    protected override async Task SerializeToStreamAsync(
        Stream stream,
        TransportContext? context,
        CancellationToken cancellationToken)
    {
      await content.CopyToAsync(stream, cancellationToken);
      serializationCompleted();
    }

    protected override bool TryComputeLength(out long length)
    {
      length = Headers.ContentLength ?? 0;

      return true;
    }
  }
}
