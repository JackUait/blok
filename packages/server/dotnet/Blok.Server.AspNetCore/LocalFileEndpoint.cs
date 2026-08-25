using System.Globalization;
using System.Text;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace Blok.Server.AspNetCore;

internal static class LocalFileEndpoint
{
  private static readonly FileExtensionContentTypeProvider ContentTypes = new();

  internal static void Map(
      IEndpointRouteBuilder endpoints,
      BlokServerOptions options)
  {
    if (options.StorageDirectory == "" || options.S3Bucket != "")
    {
      return;
    }

    var prefix = options.LocalPublicPath;

    if (prefix == "")
    {
      return;
    }

    endpoints.MapMethods(
        $"{prefix}/{{fileName}}",
        ["GET", "HEAD"],
        context => ServeAsync(
            context,
            options.StorageDirectory,
            context.Request.RouteValues["fileName"] as string ?? ""));
  }

  private static async Task ServeAsync(
      HttpContext context,
      string directory,
      string fileName)
  {
    if (!IsDirectFileName(fileName) || !BlobKey.IsGenerated(fileName))
    {
      await NotFoundAsync(context);
      return;
    }

    var path = Path.Combine(directory, fileName);
    FileStream file;

    try
    {
      file = new FileStream(
          path,
          FileMode.Open,
          FileAccess.Read,
          FileShare.Read,
          bufferSize: 81920,
          FileOptions.Asynchronous | FileOptions.SequentialScan);
    }
    catch (Exception error) when (
        error is FileNotFoundException or
        DirectoryNotFoundException or
        UnauthorizedAccessException)
    {
      await NotFoundAsync(context);
      return;
    }

    await using (file)
    {
      var contentType = ContentTypes.TryGetContentType(fileName, out var detectedContentType)
        ? detectedContentType
        : "application/octet-stream";
      var lastModified = new DateTimeOffset(
          File.GetLastWriteTimeUtc(file.SafeFileHandle));
      lastModified = lastModified.AddTicks(
          -(lastModified.Ticks % TimeSpan.TicksPerSecond));

      context.Response.Headers.ContentDisposition = "attachment";
      context.Response.Headers.XContentTypeOptions = "nosniff";
      context.Response.Headers.LastModified = lastModified.ToString(
          "R",
          CultureInfo.InvariantCulture);

      if (ApplyRepresentationPreconditions(context, lastModified))
      {
        return;
      }

      context.Response.ContentType = contentType;
      var rangeHeader = context.Request.Headers.Range.ToString();

      if (rangeHeader != "" && !IfRangeMatches(context, lastModified))
      {
        rangeHeader = "";
      }

      if (rangeHeader == "")
      {
        await ServeWholeFileAsync(context, file);
        return;
      }

      if (!TryParseRanges(
          rangeHeader,
          file.Length,
          out var ranges,
          out var rangeError))
      {
        if (file.Length == 0 && rangeError == "invalid range: failed to overlap")
        {
          await ServeWholeFileAsync(context, file);
          return;
        }

        await RejectRangeAsync(context, file.Length, rangeError);
        return;
      }

      long selectedLength = 0;

      foreach (var range in ranges)
      {
        if (selectedLength > file.Length - range.Length)
        {
          ranges.Clear();
          break;
        }

        selectedLength += range.Length;
      }

      switch (ranges.Count)
      {
        case 0:
          await ServeWholeFileAsync(context, file);
          break;
        case 1:
          await ServeSingleRangeAsync(context, file, ranges[0]);
          break;
        default:
          await ServeMultipleRangesAsync(context, file, ranges, contentType);
          break;
      }
    }
  }

  private static bool ApplyRepresentationPreconditions(
      HttpContext context,
      DateTimeOffset lastModified)
  {
    var ifMatch = context.Request.Headers.IfMatch.ToString();

    if (ifMatch != "")
    {
      if (!HasWildcardEntityTag(ifMatch))
      {
        context.Response.StatusCode =
            StatusCodes.Status412PreconditionFailed;
        return true;
      }
    }
    else
    {
      var ifUnmodifiedSince =
          context.Request.Headers.IfUnmodifiedSince.ToString();

      if (HeaderUtilities.TryParseDate(
            ifUnmodifiedSince,
            out var unmodifiedSince) &&
          lastModified > unmodifiedSince)
      {
        context.Response.StatusCode =
            StatusCodes.Status412PreconditionFailed;
        return true;
      }
    }

    var ifNoneMatch = context.Request.Headers.IfNoneMatch.ToString();

    if (ifNoneMatch != "")
    {
      if (HasWildcardEntityTag(ifNoneMatch))
      {
        context.Response.StatusCode = StatusCodes.Status304NotModified;
        return true;
      }

      return false;
    }

    var ifModifiedSince =
        context.Request.Headers.IfModifiedSince.ToString();

    if (HeaderUtilities.TryParseDate(
          ifModifiedSince,
          out var modifiedSince) &&
        lastModified <= modifiedSince)
    {
      context.Response.StatusCode = StatusCodes.Status304NotModified;
      return true;
    }

    return false;
  }

  private static bool HasWildcardEntityTag(string value)
  {
    return value.Split(',')
        .Any(candidate => candidate.Trim() == "*");
  }

  private static bool IfRangeMatches(
      HttpContext context,
      DateTimeOffset lastModified)
  {
    var ifRange = context.Request.Headers.IfRange.ToString();

    if (ifRange == "")
    {
      return true;
    }

    return HeaderUtilities.TryParseDate(ifRange, out var requestedDate) &&
        requestedDate == lastModified;
  }

  private static bool TryParseRanges(
      string header,
      long fileLength,
      out List<ByteRange> ranges,
      out string error)
  {
    ranges = [];
    error = "";

    if (!header.StartsWith("bytes=", StringComparison.Ordinal))
    {
      error = "invalid range";
      return false;
    }

    var noOverlap = false;

    foreach (var value in header[6..].Split(','))
    {
      var specification = value.Trim();

      if (specification == "")
      {
        continue;
      }

      var separator = specification.IndexOf('-');

      if (separator < 0)
      {
        error = "invalid range";
        return false;
      }

      var startText = specification[..separator].Trim();
      var endText = specification[(separator + 1)..].Trim();

      if (startText == "")
      {
        if (endText == "" ||
            endText[0] == '-' ||
            !TryParseRangeNumber(endText, out var suffixLength))
        {
          error = "invalid range";
          return false;
        }

        suffixLength = Math.Min(suffixLength, fileLength);

        if (suffixLength == 0)
        {
          noOverlap = true;
          continue;
        }

        ranges.Add(new ByteRange(
            fileLength - suffixLength,
            suffixLength));
        continue;
      }

      if (!TryParseRangeNumber(startText, out var start))
      {
        error = "invalid range";
        return false;
      }

      if (start >= fileLength)
      {
        noOverlap = true;
        continue;
      }

      if (endText == "")
      {
        ranges.Add(new ByteRange(start, fileLength - start));
        continue;
      }

      if (!TryParseRangeNumber(endText, out var end) || start > end)
      {
        error = "invalid range";
        return false;
      }

      end = Math.Min(end, fileLength - 1);
      ranges.Add(new ByteRange(start, end - start + 1));
    }

    if (noOverlap && ranges.Count == 0)
    {
      error = "invalid range: failed to overlap";
      return false;
    }

    return true;
  }

  private static bool TryParseRangeNumber(string value, out long number)
  {
    return long.TryParse(
        value,
        NumberStyles.AllowLeadingSign,
        CultureInfo.InvariantCulture,
        out number) &&
        number >= 0;
  }

  private static async Task ServeWholeFileAsync(
      HttpContext context,
      FileStream file)
  {
    context.Response.Headers.AcceptRanges = "bytes";
    context.Response.ContentLength = file.Length;

    if (!HttpMethods.IsHead(context.Request.Method))
    {
      await file.CopyToAsync(context.Response.Body, context.RequestAborted);
    }
  }

  private static async Task ServeSingleRangeAsync(
      HttpContext context,
      FileStream file,
      ByteRange range)
  {
    context.Response.StatusCode = StatusCodes.Status206PartialContent;
    context.Response.Headers.AcceptRanges = "bytes";
    context.Response.Headers.ContentRange = range.ContentRange(file.Length);
    context.Response.ContentLength = range.Length;

    if (!HttpMethods.IsHead(context.Request.Method))
    {
      file.Position = range.Start;
      await CopyBytesAsync(
          file,
          context.Response.Body,
          range.Length,
          context.RequestAborted);
    }
  }

  private static async Task ServeMultipleRangesAsync(
      HttpContext context,
      FileStream file,
      IReadOnlyList<ByteRange> ranges,
      string contentType)
  {
    var boundary = Guid.NewGuid().ToString("N");
    var partHeaders = new List<byte[]>(ranges.Count);
    long contentLength = 0;

    foreach (var range in ranges)
    {
      var header = Encoding.ASCII.GetBytes(
          $"--{boundary}\r\n" +
          $"Content-Range: {range.ContentRange(file.Length)}\r\n" +
          $"Content-Type: {contentType}\r\n" +
          "\r\n");
      partHeaders.Add(header);
      contentLength += header.Length + range.Length + 2;
    }

    var closingBoundary = Encoding.ASCII.GetBytes($"--{boundary}--\r\n");
    contentLength += closingBoundary.Length;

    context.Response.StatusCode = StatusCodes.Status206PartialContent;
    context.Response.ContentType = $"multipart/byteranges; boundary={boundary}";
    context.Response.Headers.AcceptRanges = "bytes";
    context.Response.ContentLength = contentLength;

    if (HttpMethods.IsHead(context.Request.Method))
    {
      return;
    }

    for (var index = 0; index < ranges.Count; index++)
    {
      await context.Response.Body.WriteAsync(
          partHeaders[index],
          context.RequestAborted);
      file.Position = ranges[index].Start;
      await CopyBytesAsync(
          file,
          context.Response.Body,
          ranges[index].Length,
          context.RequestAborted);
      await context.Response.Body.WriteAsync(
          "\r\n"u8.ToArray(),
          context.RequestAborted);
    }

    await context.Response.Body.WriteAsync(
        closingBoundary,
        context.RequestAborted);
  }

  private static async Task RejectRangeAsync(
      HttpContext context,
      long fileLength,
      string error)
  {
    var body = Encoding.UTF8.GetBytes($"{error}\n");

    context.Response.StatusCode = StatusCodes.Status416RangeNotSatisfiable;
    context.Response.ContentType = "text/plain; charset=utf-8";
    context.Response.ContentLength = body.Length;
    context.Response.Headers.Remove("Accept-Ranges");
    context.Response.Headers.Remove("Last-Modified");

    if (error == "invalid range: failed to overlap")
    {
      context.Response.Headers.ContentRange = $"bytes */{fileLength}";
    }

    if (!HttpMethods.IsHead(context.Request.Method))
    {
      await context.Response.Body.WriteAsync(body, context.RequestAborted);
    }
  }

  private static async Task CopyBytesAsync(
      Stream source,
      Stream destination,
      long count,
      CancellationToken cancellationToken)
  {
    var buffer = new byte[81920];

    while (count > 0)
    {
      var read = await source.ReadAsync(
          buffer.AsMemory(0, (int)Math.Min(buffer.Length, count)),
          cancellationToken);

      if (read == 0)
      {
        throw new EndOfStreamException();
      }

      await destination.WriteAsync(
          buffer.AsMemory(0, read),
          cancellationToken);
      count -= read;
    }
  }

  private readonly record struct ByteRange(long Start, long Length)
  {
    internal string ContentRange(long fileLength)
    {
      return $"bytes {Start}-{Start + Length - 1}/{fileLength}";
    }
  }

  private static bool IsDirectFileName(string fileName)
  {
    return fileName is not ("" or "." or "..") &&
        fileName.IndexOfAny(['/', '\\']) < 0;
  }

  private static async Task NotFoundAsync(HttpContext context)
  {
    context.Response.StatusCode = StatusCodes.Status404NotFound;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync("404 page not found\n");
  }
}
