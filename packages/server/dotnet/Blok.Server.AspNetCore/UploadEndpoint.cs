using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using ContentDispositionHeaderValue = Microsoft.Net.Http.Headers.ContentDispositionHeaderValue;
using HeaderUtilities = Microsoft.Net.Http.Headers.HeaderUtilities;
using MediaTypeHeaderValue = Microsoft.Net.Http.Headers.MediaTypeHeaderValue;

namespace Blok.Server.AspNetCore;

internal static class UploadEndpoint
{
  private const int MaximumBoundaryLength = 128;
  private const int MaximumFileNameBytes = 255;
  private const int MaximumMediaTypeLength = 255;
  private const int CopyBufferSize = 81920;

  internal static async Task HandleAsync(HttpContext context)
  {
    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    var bodySize = context.Features.Get<IHttpMaxRequestBodySizeFeature>();

    if (bodySize is { IsReadOnly: false })
    {
      bodySize.MaxRequestBodySize = options.MaxUploadBytes;
    }

    if (context.Request.ContentLength > options.MaxUploadBytes)
    {
      await WriteErrorAsync(
          context,
          StatusCodes.Status413PayloadTooLarge,
          "file too large\n");
      return;
    }

    if (!TryGetBoundary(context.Request.ContentType, out var boundary))
    {
      await WriteErrorAsync(
          context,
          StatusCodes.Status400BadRequest,
          "malformed upload\n");
      return;
    }

    string temporaryPath = "";
    FileStream? temporaryFile = null;

    try
    {
      var requestBody = new BoundedReadStream(
          context.Request.Body,
          options.MaxUploadBytes);
      string fileName = "";
      string mimeType = "";

      try
      {
        var reader = new MultipartReader(boundary, requestBody);
        MultipartSection? section;

        while ((section = await reader.ReadNextSectionAsync(
                   context.RequestAborted)) is not null)
        {
          if (temporaryFile is not null ||
              !TryGetFileMetadata(section, out fileName, out mimeType))
          {
            continue;
          }

          temporaryPath = Path.Combine(
              Path.GetTempPath(),
              $".blok-upload-{Guid.NewGuid():N}");
          temporaryFile = new FileStream(
              temporaryPath,
              FileMode.CreateNew,
              FileAccess.ReadWrite,
              FileShare.None,
              CopyBufferSize,
              FileOptions.Asynchronous | FileOptions.SequentialScan);
          var content = IsQuotedPrintable(section)
            ? new QuotedPrintableReadStream(section.Body)
            : section.Body;
          await content.CopyToAsync(
              temporaryFile,
              CopyBufferSize,
              context.RequestAborted);
        }

        await requestBody.DrainAsync(context.RequestAborted);
      }
      catch (Exception error) when (
          error is UploadTooLargeException or
          BadHttpRequestException
          {
            StatusCode: StatusCodes.Status413PayloadTooLarge
          })
      {
        await WriteErrorAsync(
            context,
            StatusCodes.Status413PayloadTooLarge,
            "file too large\n");
        return;
      }
      catch (Exception error) when (
          error is InvalidDataException or IOException)
      {
        await WriteErrorAsync(
            context,
            StatusCodes.Status400BadRequest,
            "malformed upload\n");
        return;
      }

      if (temporaryFile is null)
      {
        await WriteErrorAsync(
            context,
            StatusCodes.Status400BadRequest,
            "missing file field\n");
        return;
      }

      temporaryFile.Position = 0;
      await using var countedContent = new CountingReadStream(temporaryFile);
      string url;

      try
      {
        var store = context.RequestServices.GetService<IBlobStore>() ??
            throw new InvalidOperationException("No blob store is registered.");
        url = await store.PutAsync(
            BlobKey.NormalizeExtension(Path.GetExtension(fileName)),
            mimeType,
            countedContent,
            context.RequestAborted);
      }
      catch (OperationCanceledException) when (
          context.RequestAborted.IsCancellationRequested)
      {
        throw;
      }
      catch (Exception)
      {
        await WriteErrorAsync(
            context,
            StatusCodes.Status502BadGateway,
            "upload failed\n");
        return;
      }

      var response = new UploadResponse(
          url,
          fileName == "" ? null : fileName,
          countedContent.BytesRead == 0 ? null : countedContent.BytesRead,
          mimeType == "" ? null : mimeType);
      context.Response.ContentType = "application/json";
      await context.Response.WriteAsync(
          JsonSerializer.Serialize(response) + "\n",
          context.RequestAborted);
    }
    finally
    {
      if (temporaryFile is not null)
      {
        await temporaryFile.DisposeAsync();
      }

      if (temporaryPath != "")
      {
        File.Delete(temporaryPath);
      }
    }
  }

  private static bool TryGetBoundary(
      string? contentType,
      out string boundary)
  {
    boundary = "";

    if (!MediaTypeHeaderValue.TryParse(contentType, out var parsed) ||
        !string.Equals(
            parsed.MediaType.Value,
            "multipart/form-data",
            StringComparison.OrdinalIgnoreCase) ||
        HasConflictingParameters(parsed))
    {
      return false;
    }

    boundary = HeaderUtilities.RemoveQuotes(parsed.Boundary).Value ?? "";

    return boundary.Length is > 0 and <= MaximumBoundaryLength;
  }

  private static bool HasConflictingParameters(
      MediaTypeHeaderValue mediaType)
  {
    var values = new Dictionary<string, string>(
        StringComparer.OrdinalIgnoreCase);

    foreach (var parameter in mediaType.Parameters)
    {
      var name = parameter.Name.Value ?? "";
      var value = Unquote(parameter.Value);

      if (values.TryGetValue(name, out var existing) &&
          existing != value)
      {
        return true;
      }

      values[name] = value;
    }

    return false;
  }

  private static bool TryGetFileMetadata(
      MultipartSection section,
      out string fileName,
      out string mimeType)
  {
    fileName = "";
    mimeType = "";

    if (!ContentDispositionHeaderValue.TryParse(
          section.ContentDisposition,
          out var disposition) ||
        !string.Equals(
            disposition.DispositionType.Value,
            "form-data",
            StringComparison.OrdinalIgnoreCase) ||
        HeaderUtilities.RemoveQuotes(disposition.Name).Value != "file")
    {
      return false;
    }

    var rawFileName = disposition.FileNameStar.HasValue
      ? disposition.FileNameStar
      : disposition.FileName;

    if (!rawFileName.HasValue)
    {
      return false;
    }

    fileName = SanitizeFileName(Unquote(rawFileName));
    mimeType = SanitizeMediaType(section.ContentType);

    return true;
  }

  private static bool IsQuotedPrintable(MultipartSection section)
  {
    return section.Headers is { } headers &&
        headers.TryGetValue(
            "Content-Transfer-Encoding",
            out var values) &&
        values.Count > 0 &&
        string.Equals(
            values[0]?.Trim(),
            "quoted-printable",
            StringComparison.OrdinalIgnoreCase);
  }

  private static string Unquote(StringSegment value)
  {
    var raw = value.Value ?? "";
    var quoted = raw.Length >= 2 && raw[0] == '"' && raw[^1] == '"';
    var unquoted = HeaderUtilities.RemoveQuotes(value).Value ?? "";

    if (!quoted || unquoted.IndexOf('\\') < 0)
    {
      return unquoted;
    }

    var result = new StringBuilder(unquoted.Length);

    for (var index = 0; index < unquoted.Length; index++)
    {
      if (unquoted[index] == '\\' && index + 1 < unquoted.Length)
      {
        index++;
      }

      result.Append(unquoted[index]);
    }

    return result.ToString();
  }

  private static string SanitizeFileName(string fileName)
  {
    var separator = fileName.LastIndexOfAny(['/', '\\']);

    if (separator >= 0)
    {
      fileName = fileName[(separator + 1)..];
    }

    return fileName is "." or ".." ||
        Encoding.UTF8.GetByteCount(fileName) > MaximumFileNameBytes
      ? ""
      : fileName;
  }

  private static string SanitizeMediaType(string? mediaType)
  {
    var candidate = mediaType?.Trim() ?? "";

    return candidate.Length is > 0 and <= MaximumMediaTypeLength &&
        MediaTypeHeaderValue.TryParse(candidate, out var parsed) &&
        !HasConflictingParameters(parsed)
      ? candidate
      : "";
  }

  private static async Task WriteErrorAsync(
      HttpContext context,
      int statusCode,
      string body)
  {
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync(body, context.RequestAborted);
  }

  private sealed record UploadResponse(
      [property: JsonPropertyName("url")] string Url,
      [property: JsonPropertyName("fileName")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? FileName,
      [property: JsonPropertyName("size")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      long? Size,
      [property: JsonPropertyName("mimeType")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? MimeType);

  private sealed class UploadTooLargeException : Exception;

  private sealed class BoundedReadStream(
      Stream inner,
      long maximumBytes) : Stream
  {
    private readonly byte[] _probe = new byte[1];
    private long _bytesRead;

    public override bool CanRead => inner.CanRead;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
    }

    public override int Read(
        byte[] buffer,
        int offset,
        int count)
    {
      return Read(buffer.AsSpan(offset, count));
    }

    public override int Read(Span<byte> buffer)
    {
      if (buffer.Length == 0)
      {
        return 0;
      }

      if (_bytesRead == maximumBytes)
      {
        if (inner.Read(_probe, 0, 1) == 0)
        {
          return 0;
        }

        throw new UploadTooLargeException();
      }

      var allowed = (int)Math.Min(buffer.Length, maximumBytes - _bytesRead);
      var read = inner.Read(buffer[..allowed]);
      _bytesRead += read;

      return read;
    }

    public override Task<int> ReadAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
      return ReadAsync(
          buffer.AsMemory(offset, count),
          cancellationToken).AsTask();
    }

    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (buffer.Length == 0)
      {
        return 0;
      }

      if (_bytesRead == maximumBytes)
      {
        if (await inner.ReadAsync(
              _probe.AsMemory(),
              cancellationToken) == 0)
        {
          return 0;
        }

        throw new UploadTooLargeException();
      }

      var allowed = (int)Math.Min(buffer.Length, maximumBytes - _bytesRead);
      var read = await inner.ReadAsync(
          buffer[..allowed],
          cancellationToken);
      _bytesRead += read;

      return read;
    }

    internal async Task DrainAsync(CancellationToken cancellationToken)
    {
      var buffer = new byte[CopyBufferSize];

      while (await ReadAsync(buffer, cancellationToken) != 0)
      {
      }
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
      throw new NotSupportedException();
    }

    public override void SetLength(long value)
    {
      throw new NotSupportedException();
    }

    public override void Write(
        byte[] buffer,
        int offset,
        int count)
    {
      throw new NotSupportedException();
    }
  }

  private sealed class QuotedPrintableReadStream(Stream inner) : Stream
  {
    private const int MaximumLineBytes = 4096;
    private readonly byte[] _decodedLine = new byte[MaximumLineBytes];
    private readonly byte[] _encodedLine = new byte[MaximumLineBytes];
    private readonly byte[] _input = new byte[MaximumLineBytes];
    private int _decodedLength;
    private int _decodedOffset;
    private bool _endOfInput;
    private int _inputLength;
    private int _inputOffset;
    private InvalidDataException? _pendingError;

    public override bool CanRead => inner.CanRead;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
    }

    public override int Read(
        byte[] buffer,
        int offset,
        int count)
    {
      return ReadAsync(buffer.AsMemory(offset, count))
          .AsTask()
          .GetAwaiter()
          .GetResult();
    }

    public override Task<int> ReadAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
      return ReadAsync(
          buffer.AsMemory(offset, count),
          cancellationToken).AsTask();
    }

    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      if (buffer.Length == 0)
      {
        return 0;
      }

      while (_decodedOffset == _decodedLength)
      {
        if (_pendingError is not null)
        {
          throw _pendingError;
        }

        if (_endOfInput)
        {
          return 0;
        }

        await FillDecodedLineAsync(cancellationToken);
      }

      var count = Math.Min(
          buffer.Length,
          _decodedLength - _decodedOffset);
      _decodedLine.AsMemory(_decodedOffset, count).CopyTo(buffer);
      _decodedOffset += count;

      return count;
    }

    private async Task FillDecodedLineAsync(
        CancellationToken cancellationToken)
    {
      _decodedOffset = 0;
      _decodedLength = 0;
      var encodedLength = 0;

      while (true)
      {
        var next = await ReadByteAsync(cancellationToken);

        if (next < 0)
        {
          _endOfInput = true;
          break;
        }

        _encodedLine[encodedLength++] = (byte)next;

        if (next == '\n')
        {
          break;
        }

        if (encodedLength == _encodedLine.Length)
        {
          _pendingError = new InvalidDataException(
              "quoted-printable line exceeds 4096 bytes");
          break;
        }
      }

      if (encodedLength == 0)
      {
        return;
      }

      var hasLineFeed = _encodedLine[encodedLength - 1] == '\n';
      var hasCarriageReturn = hasLineFeed &&
          encodedLength >= 2 &&
          _encodedLine[encodedLength - 2] == '\r';
      var contentLength = encodedLength;

      while (contentLength > 0 &&
             IsDiscardedTrailingWhitespace(_encodedLine[contentLength - 1]))
      {
        contentLength--;
      }

      var appendLineEnding = hasLineFeed;

      if (contentLength > 0 &&
          _encodedLine[contentLength - 1] == '=')
      {
        var suffix = contentLength;

        while (suffix < encodedLength &&
               _encodedLine[suffix] is (byte)' ' or (byte)'\t')
        {
          suffix++;
        }

        contentLength--;
        appendLineEnding = false;

        if (!StartsWithLineEnding(suffix, encodedLength) &&
            !(suffix == encodedLength &&
              contentLength > 0 &&
              _endOfInput))
        {
          _pendingError ??= new InvalidDataException(
              "invalid bytes after quoted-printable soft break");
        }
      }

      for (var index = 0; index < contentLength; index++)
      {
        var value = _encodedLine[index];

        if (value == '=' &&
            index + 2 < contentLength &&
            TryHex(_encodedLine[index + 1], out var high) &&
            TryHex(_encodedLine[index + 2], out var low))
        {
          _decodedLine[_decodedLength++] = (byte)((high << 4) | low);
          index += 2;
          continue;
        }

        if (value == '=' &&
            (index + 1 >= contentLength ||
             _encodedLine[index + 1] is (byte)'\r' or (byte)'\n'))
        {
          _pendingError ??= new InvalidDataException(
              "invalid quoted-printable hex byte");
          break;
        }

        if (value is not (byte)'\t' and not (byte)'\r' and not (byte)'\n' &&
            value < 0x80 &&
            (value < (byte)' ' || value > (byte)'~'))
        {
          _pendingError ??= new InvalidDataException(
              "invalid unescaped quoted-printable byte");
          break;
        }

        _decodedLine[_decodedLength++] = value;
      }

      if (appendLineEnding)
      {
        if (hasCarriageReturn)
        {
          _decodedLine[_decodedLength++] = (byte)'\r';
        }

        _decodedLine[_decodedLength++] = (byte)'\n';
      }
    }

    private async ValueTask<int> ReadByteAsync(
        CancellationToken cancellationToken)
    {
      if (_inputOffset == _inputLength)
      {
        _inputLength = await inner.ReadAsync(_input, cancellationToken);
        _inputOffset = 0;

        if (_inputLength == 0)
        {
          return -1;
        }
      }

      return _input[_inputOffset++];
    }

    private bool StartsWithLineEnding(
        int suffix,
        int encodedLength)
    {
      return suffix < encodedLength &&
          (_encodedLine[suffix] == '\n' ||
           (_encodedLine[suffix] == '\r' &&
            suffix + 1 < encodedLength &&
            _encodedLine[suffix + 1] == '\n'));
    }

    private static bool IsDiscardedTrailingWhitespace(byte value)
    {
      return value is (byte)'\n' or (byte)'\r' or (byte)' ' or (byte)'\t';
    }

    private static bool TryHex(byte value, out int decoded)
    {
      switch (value)
      {
        case >= (byte)'0' and <= (byte)'9':
          decoded = value - '0';
          return true;
        case >= (byte)'A' and <= (byte)'F':
          decoded = value - 'A' + 10;
          return true;
        case >= (byte)'a' and <= (byte)'f':
          decoded = value - 'a' + 10;
          return true;
        default:
          decoded = 0;
          return false;
      }
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
      throw new NotSupportedException();
    }

    public override void SetLength(long value)
    {
      throw new NotSupportedException();
    }

    public override void Write(
        byte[] buffer,
        int offset,
        int count)
    {
      throw new NotSupportedException();
    }
  }

  private sealed class CountingReadStream(Stream inner) : Stream
  {
    private bool _disposed;

    internal long BytesRead { get; private set; }

    public override bool CanRead => !_disposed && inner.CanRead;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
      ThrowIfDisposed();
    }

    public override int Read(
        byte[] buffer,
        int offset,
        int count)
    {
      ThrowIfDisposed();
      var read = inner.Read(buffer, offset, count);
      BytesRead += read;

      return read;
    }

    public override int Read(Span<byte> buffer)
    {
      ThrowIfDisposed();
      var read = inner.Read(buffer);
      BytesRead += read;

      return read;
    }

    public override Task<int> ReadAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
      return ReadAsync(
          buffer.AsMemory(offset, count),
          cancellationToken).AsTask();
    }

    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      ThrowIfDisposed();
      var read = await inner.ReadAsync(buffer, cancellationToken);
      BytesRead += read;

      return read;
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
      throw new NotSupportedException();
    }

    public override void SetLength(long value)
    {
      throw new NotSupportedException();
    }

    public override void Write(
        byte[] buffer,
        int offset,
        int count)
    {
      throw new NotSupportedException();
    }

    protected override void Dispose(bool disposing)
    {
      _disposed = true;
      base.Dispose(disposing);
    }

    private void ThrowIfDisposed()
    {
      ObjectDisposedException.ThrowIf(_disposed, this);
    }
  }
}
