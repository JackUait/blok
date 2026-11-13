using System.Globalization;
using Blok.Server.Outbound;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore;

/// <summary>
/// GET /file-bytes?url=: a PDF's bytes for the editor's preview, one Range at
/// a time. The server's own stored files are read from the store; anything
/// else is fetched.
/// </summary>
internal static class FileBytesEndpoint
{
  // The PDF check: "%PDF-" within a file's first CheckBytes bytes.
  private const int CheckBytes = 1024;

  // One answer is read whole before it is written, so it is capped. A larger
  // answer is 413: ask for a Range. The editor reads in chunks of at most this.
  private const int AnswerBytes = 1 << 20;

  private static readonly byte[] PdfMagic = "%PDF-"u8.ToArray();

  internal static async Task HandleAsync(HttpContext context)
  {
    var target = context.Request.Query["url"].FirstOrDefault() ?? "";
    if (target == "")
    {
      await WriteTextAsync(context, StatusCodes.Status400BadRequest, "expected ?url=...\n");
      return;
    }

    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    var range = RequestedRange(context.Request.Headers);

    // The same match LocalBlobStore.DeleteAsync makes: stored URLs are PublicUrl + key.
    if (options.StorageDirectory != "" &&
        options.S3Bucket == "" &&
        BlobKey.TryParsePublicUrl(options.PublicUrl, target, out var key))
    {
      await ServeStoredAsync(context, options, key, range);
      return;
    }

    await ServeRemoteAsync(context, options, target, range);
  }

  // The one Range forwarded: "bytes=a-b" or "bytes=a-". Anything else is
  // ignored and the whole file is served.
  private static GuardedByteRange? RequestedRange(IHeaderDictionary headers)
  {
    var values = headers.Range;
    if (values.Count != 1 || values[0] is not { } value || !value.StartsWith("bytes=", StringComparison.Ordinal))
    {
      return null;
    }

    var spec = value["bytes=".Length..];
    var dash = spec.IndexOf('-', StringComparison.Ordinal);
    if (dash < 0 || !TryParseDigits(spec[..dash], out var start))
    {
      return null;
    }

    var endText = spec[(dash + 1)..];
    if (endText == "")
    {
      return new GuardedByteRange(start, -1);
    }

    return TryParseDigits(endText, out var end) && end >= start
      ? new GuardedByteRange(start, end)
      : null;
  }

  // ASCII digits only: no sign, no space.
  private static bool TryParseDigits(string text, out long value)
  {
    value = 0;
    return text != "" &&
        text.All(char.IsAsciiDigit) &&
        long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value);
  }

  private static async Task ServeStoredAsync(
      HttpContext context,
      BlokServerOptions options,
      string key,
      GuardedByteRange? range)
  {
    FileStream file;
    try
    {
      file = new FileStream(
          Path.Combine(options.StorageDirectory, key),
          FileMode.Open,
          FileAccess.Read,
          FileShare.Read,
          bufferSize: 81920,
          FileOptions.Asynchronous);
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
    {
      await WriteTextAsync(context, StatusCodes.Status404NotFound, "not found\n");
      return;
    }

    await using (file)
    {
      var size = file.Length;
      if (size > options.FileBytesMaxBytes)
      {
        await WriteTextAsync(context, StatusCodes.Status413RequestEntityTooLarge, "file too large\n");
        return;
      }

      var head = new byte[CheckBytes];
      var read = await RandomAccess.ReadAsync(file.SafeFileHandle, head, 0, context.RequestAborted);
      if (head.AsSpan(0, read).IndexOf(PdfMagic) < 0)
      {
        await WriteTextAsync(context, StatusCodes.Status415UnsupportedMediaType, "not a pdf\n");
        return;
      }

      var (status, start, length) = (StatusCodes.Status200OK, 0L, size);
      if (range is { } asked)
      {
        if (asked.Start >= size)
        {
          context.Response.Headers.ContentRange = $"bytes */{size.ToString(CultureInfo.InvariantCulture)}";
          await WriteTextAsync(context, StatusCodes.Status416RangeNotSatisfiable, "range not satisfiable\n");
          return;
        }

        var end = asked.End >= 0 && asked.End < size - 1 ? asked.End : size - 1;
        (status, start, length) = (StatusCodes.Status206PartialContent, asked.Start, end - asked.Start + 1);
      }

      // The same cap as a fetched answer, so both sources behave alike.
      if (length > AnswerBytes)
      {
        await WriteTextAsync(context, StatusCodes.Status413RequestEntityTooLarge, "range too large\n");
        return;
      }

      var body = new byte[length];
      for (var filled = 0; filled < body.Length;)
      {
        var got = await RandomAccess.ReadAsync(
            file.SafeFileHandle, body.AsMemory(filled), start + filled, context.RequestAborted);
        if (got == 0)
        {
          // The file shrank after it was measured.
          context.Abort();
          return;
        }

        filled += got;
      }

      WritePdfHead(context.Response, status, start, length, size);
      await context.Response.Body.WriteAsync(body, context.RequestAborted);
    }
  }

  private static async Task ServeRemoteAsync(
      HttpContext context,
      BlokServerOptions options,
      string target,
      GuardedByteRange? range)
  {
    var fetcher = context.RequestServices.GetRequiredService<IGuardedOutboundFetcher>();
    var allowHop = context.Features.Get<HopBudgetFeature>()?.AllowHop;
    var caller = OutboundCaller.Of(context);
    GuardedResponse response;

    try
    {
      response = await fetcher.GetAsync(
          target,
          new GuardedFetchLimits(
              TimeSpan.FromMinutes(2),
              AnswerBytes,
              5,
              allowHop,
              Upload: true,
              Caller: caller,
              Range: range),
          context.RequestAborted);
    }
    catch (GuardedFetchException error) when (error.Failure == GuardedFetchFailure.ResponseTooLarge)
    {
      await WriteTextAsync(context, StatusCodes.Status413RequestEntityTooLarge, "range too large\n");
      return;
    }
    catch (GuardedFetchException)
    {
      await FailedAsync(context);
      return;
    }

    // Read whole first and freed before any write: a client that stops
    // reading must never hold a shared fetch slot.
    await response.DisposeAsync();

    if (!TryUpstreamExtent(response, out var start, out var total) ||
        response.StatusCode is < 200 or > 299 ||
        Encoded(response))
    {
      await FailedAsync(context);
      return;
    }

    if (total > options.FileBytesMaxBytes)
    {
      await WriteTextAsync(context, StatusCodes.Status413RequestEntityTooLarge, "file too large\n");
      return;
    }

    var checks = context.RequestServices.GetRequiredService<PdfCheckCache>();
    if (!checks.Has(response.FinalUrl))
    {
      var body = response.Body.Span;
      if (start != 0 || body[..Math.Min(body.Length, CheckBytes)].IndexOf(PdfMagic) < 0)
      {
        // A second fetch, charged like a redirect hop.
        if (allowHop is not null && !allowHop())
        {
          await WriteTextAsync(context, StatusCodes.Status429TooManyRequests, "rate limit exceeded\n");
          return;
        }

        bool pdf;
        try
        {
          pdf = await ProbeAsync(fetcher, response.FinalUrl, allowHop, caller, context.RequestAborted);
        }
        catch (GuardedFetchException)
        {
          await FailedAsync(context);
          return;
        }

        if (!pdf)
        {
          await WriteTextAsync(context, StatusCodes.Status415UnsupportedMediaType, "not a pdf\n");
          return;
        }
      }

      checks.Add(response.FinalUrl);
    }

    var status = response.StatusCode == StatusCodes.Status206PartialContent
      ? StatusCodes.Status206PartialContent
      : StatusCodes.Status200OK;
    WritePdfHead(context.Response, status, start, response.Body.Length, total);
    await context.Response.Body.WriteAsync(response.Body, context.RequestAborted);
  }

  // Reads the first CheckBytes of url. Throws GuardedFetchException when the
  // check fetch itself fails.
  private static async Task<bool> ProbeAsync(
      IGuardedOutboundFetcher fetcher,
      string url,
      Func<bool>? allowHop,
      string? caller,
      CancellationToken cancellationToken)
  {
    await using var probe = await fetcher.GetAsync(
        url,
        new GuardedFetchLimits(
            TimeSpan.FromSeconds(10),
            CheckBytes,
            5,
            allowHop,
            TruncateBody: true,
            Caller: caller,
            Range: new GuardedByteRange(0, CheckBytes - 1)),
        cancellationToken);

    if (probe.StatusCode is < 200 or > 299 || Encoded(probe))
    {
      throw new GuardedFetchException(GuardedFetchFailure.BlockedDestination);
    }

    return probe.Body.Span.IndexOf(PdfMagic) >= 0;
  }

  // Any Content-Encoding but identity: decoding would move every byte offset
  // a Range names.
  private static bool Encoded(GuardedResponse response)
  {
    return response.HeaderValues("Content-Encoding")
        .SelectMany(line => line.Split(','))
        .Select(token => token.Trim())
        .Any(token => token != "" && !string.Equals(token, "identity", StringComparison.OrdinalIgnoreCase));
  }

  // Where the body sits in the file: a 206's Content-Range, which must match
  // the body, else the whole file. total -1 is unknown.
  private static bool TryUpstreamExtent(GuardedResponse response, out long start, out long total)
  {
    long length = response.Body.Length;
    (start, total) = (0, length);
    if (response.StatusCode != StatusCodes.Status206PartialContent)
    {
      return true;
    }

    var lines = response.HeaderValues("Content-Range");
    var header = lines.Count > 0 ? lines[0] : "";
    var slash = header.IndexOf('/', StringComparison.Ordinal);
    var span = slash < 0 ? "" : header[..slash];
    var dash = span.IndexOf('-', StringComparison.Ordinal);
    if (!header.StartsWith("bytes ", StringComparison.Ordinal) ||
        slash < 0 ||
        dash < 0 ||
        !TryParseDigits(span["bytes ".Length..dash], out start) ||
        !TryParseDigits(span[(dash + 1)..], out var end) ||
        end < start ||
        end - start + 1 != length)
    {
      return false;
    }

    var totalText = header[(slash + 1)..];
    total = -1;
    if (totalText != "*")
    {
      if (!TryParseDigits(totalText, out total) || end >= total)
      {
        return false;
      }
    }

    return true;
  }

  // The headers every PDF answer carries. total -1 is an unknown size.
  private static void WritePdfHead(HttpResponse response, int status, long start, long length, long total)
  {
    var headers = response.Headers;
    response.StatusCode = status;
    response.ContentType = "application/pdf";
    headers.XContentTypeOptions = "nosniff";
    headers.ContentSecurityPolicy = "sandbox";
    headers.AcceptRanges = "bytes";
    headers.AccessControlExposeHeaders = "Accept-Ranges, Content-Length, Content-Range";
    // Set, not appended: one line over the guard's "Vary: Origin".
    headers.Vary = "Origin, Authorization";
    headers.CacheControl = "private, max-age=300";
    response.ContentLength = length;
    if (status == StatusCodes.Status206PartialContent)
    {
      var size = total >= 0 ? total.ToString(CultureInfo.InvariantCulture) : "*";
      headers.ContentRange = string.Create(
          CultureInfo.InvariantCulture,
          $"bytes {start}-{start + length - 1}/{size}");
    }
  }

  private static Task FailedAsync(HttpContext context)
  {
    return context.RequestAborted.IsCancellationRequested
      ? Task.CompletedTask
      : WriteTextAsync(context, StatusCodes.Status502BadGateway, "the URL could not be fetched\n");
  }

  private static async Task WriteTextAsync(HttpContext context, int status, string body)
  {
    context.Response.StatusCode = status;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync(body);
  }
}

/// <summary>
/// Final URLs (after redirects) that passed the PDF check, least recently
/// used first out. Keyed by the final URL, so a redirect that later points
/// somewhere else is checked again.
/// </summary>
internal sealed class PdfCheckCache(TimeProvider clock)
{
  private const int Entries = 256;
  private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

  private readonly Lock gate = new();
  private readonly LinkedList<(string Url, DateTimeOffset At)> order = new();
  private readonly Dictionary<string, LinkedListNode<(string Url, DateTimeOffset At)>> entries =
      new(StringComparer.Ordinal);

  internal bool Has(string url)
  {
    lock (gate)
    {
      if (!entries.TryGetValue(url, out var node))
      {
        return false;
      }

      if (clock.GetUtcNow() - node.Value.At >= Ttl)
      {
        order.Remove(node);
        entries.Remove(url);
        return false;
      }

      order.Remove(node);
      order.AddFirst(node);
      return true;
    }
  }

  internal void Add(string url)
  {
    lock (gate)
    {
      if (entries.TryGetValue(url, out var node))
      {
        order.Remove(node);
        node.Value = (url, clock.GetUtcNow());
        order.AddFirst(node);
        return;
      }

      entries[url] = order.AddFirst((url, clock.GetUtcNow()));
      if (order.Count > Entries)
      {
        var oldest = order.Last!;
        order.RemoveLast();
        entries.Remove(oldest.Value.Url);
      }
    }
  }
}
