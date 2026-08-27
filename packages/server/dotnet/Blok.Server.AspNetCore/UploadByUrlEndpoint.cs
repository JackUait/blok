using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Outbound;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using MediaTypeHeaderValue = Microsoft.Net.Http.Headers.MediaTypeHeaderValue;

namespace Blok.Server.AspNetCore;

internal static class UploadByUrlEndpoint
{
  private const int MaximumEnvelopeBytes = 8 << 10;
  private static readonly JsonSerializerOptions RequestJson = new()
  {
    PropertyNameCaseInsensitive = true,
  };

  internal static async Task HandleAsync(HttpContext context)
  {
    if (!MediaTypeHeaderValue.TryParse(
          context.Request.ContentType,
          out var contentType) ||
        !string.Equals(
            contentType.MediaType.Value,
            "application/json",
            StringComparison.OrdinalIgnoreCase) ||
        UploadWire.HasConflictingParameters(contentType))
    {
      await WriteErrorAsync(
          context,
          StatusCodes.Status415UnsupportedMediaType,
          "expected application/json\n");
      return;
    }

    var buffer = new byte[MaximumEnvelopeBytes + 1];
    var length = 0;

    while (length < buffer.Length)
    {
      var read = await context.Request.Body.ReadAsync(
          buffer.AsMemory(length),
          context.RequestAborted);

      if (read == 0)
      {
        break;
      }

      length += read;
    }

    if (length > MaximumEnvelopeBytes ||
        !TryReadTarget(buffer.AsSpan(0, length), out var target))
    {
      await WriteErrorAsync(
          context,
          StatusCodes.Status400BadRequest,
          "expected {\"url\": \"...\"}\n");
      return;
    }

    var options = context.RequestServices
        .GetRequiredService<BlokServerOptions>();
    GuardedResponse response;

    try
    {
      var fetcher = context.RequestServices
          .GetRequiredService<IGuardedOutboundFetcher>();
      response = await fetcher.GetAsync(
          target,
          new GuardedFetchLimits(
              TimeSpan.FromMinutes(2),
              options.MaxUploadBytes,
              5),
          context.RequestAborted);
    }
    catch (GuardedFetchException)
    {
      await WriteErrorAsync(
          context,
          StatusCodes.Status400BadRequest,
          "the URL could not be fetched\n");
      return;
    }

    await using var ownedResponse = response;

    if (response.StatusCode is < 200 or > 299)
    {
      await WriteErrorAsync(
          context,
          StatusCodes.Status400BadRequest,
          "the URL could not be fetched\n");
      return;
    }

    var fileName = NameFromUrl(response.FinalUrl);
    var mimeType = UploadWire.SanitizeMediaType(response.ContentType);
    string url;

    try
    {
      var store = context.RequestServices.GetService<IBlobStore>() ??
          throw new InvalidOperationException("No blob store is registered.");
      ArraySegment<byte> body;
      if (response.Body.IsEmpty)
      {
        body = new ArraySegment<byte>(Array.Empty<byte>());
      }
      else if (!MemoryMarshal.TryGetArray(response.Body, out body) ||
               body.Array is null)
      {
        throw new InvalidOperationException(
            "The guarded response body is not array-backed.");
      }

      var bodyArray = body.Array ??
          throw new InvalidOperationException(
              "The guarded response body is not array-backed.");
      await using var content = new MemoryStream(
          bodyArray,
          body.Offset,
          body.Count,
          writable: false,
          publiclyVisible: false);
      url = await store.PutAsync(
          BlobKey.NormalizeExtension(Path.GetExtension(fileName)),
          mimeType,
          content,
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

    await UploadWire.WriteResponseAsync(
        context,
        url,
        fileName,
        response.Body.Length,
        mimeType);
  }

  private static bool TryReadTarget(
      ReadOnlySpan<byte> json,
      out string target)
  {
    try
    {
      var reader = new Utf8JsonReader(
          json,
          isFinalBlock: true,
          state: default);
      var request = JsonSerializer.Deserialize<UploadRequest>(
          ref reader,
          RequestJson);
      target = request?.Url ?? "";

      if (target == "" || reader.Read())
      {
        target = "";
        return false;
      }

      return true;
    }
    catch (JsonException)
    {
      target = "";

      return false;
    }
  }

  private static string NameFromUrl(string rawUrl)
  {
    if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var url))
    {
      return "";
    }

    return UploadWire.SanitizeFileName(
        Uri.UnescapeDataString(url.AbsolutePath));
  }

  private static async Task WriteErrorAsync(
      HttpContext context,
      int statusCode,
      string body)
  {
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "text/plain; charset=utf-8";
    await context.Response.WriteAsync(
        body,
        context.RequestAborted);
  }

  private sealed class UploadRequest
  {
    private string _url = "";

    [JsonPropertyName("url")]
    public string Url
    {
      get => _url;
      init
      {
        if (value is not null)
        {
          _url = value;
        }
      }
    }
  }
}
