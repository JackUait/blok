using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using ContentDispositionHeaderValue = Microsoft.Net.Http.Headers.ContentDispositionHeaderValue;
using HeaderUtilities = Microsoft.Net.Http.Headers.HeaderUtilities;
using MediaTypeHeaderValue = Microsoft.Net.Http.Headers.MediaTypeHeaderValue;

namespace Blok.Server.AspNetCore;

internal static class UploadEndpoint
{
  private const int MaximumFileNameBytes = 255;
  private const int MaximumMediaTypeLength = 255;
  private const int CopyBufferSize = 81920;

  internal static async Task HandleAsync(HttpContext context)
  {
    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();

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
          await section.Body.CopyToAsync(
              temporaryFile,
              CopyBufferSize,
              context.RequestAborted);
        }

        await requestBody.DrainAsync(context.RequestAborted);
      }
      catch (UploadTooLargeException)
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
            Path.GetExtension(fileName),
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
            StringComparison.OrdinalIgnoreCase))
    {
      return false;
    }

    boundary = HeaderUtilities.RemoveQuotes(parsed.Boundary).Value ?? "";

    return boundary != "";
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
        MediaTypeHeaderValue.TryParse(candidate, out _)
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
