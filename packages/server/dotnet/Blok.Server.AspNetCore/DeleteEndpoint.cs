using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using MediaTypeHeaderValue = Microsoft.Net.Http.Headers.MediaTypeHeaderValue;

namespace Blok.Server.AspNetCore;

internal static class DeleteEndpoint
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

    try
    {
      var store = context.RequestServices.GetService<IBlobStore>() ??
          throw new InvalidOperationException("No blob store is registered.");
      await store.DeleteAsync(target, context.RequestAborted);
    }
    catch (ForeignBlobUrlException)
    {
      // A URL this store never issued is indistinguishable from one it
      // issued and already forgot: answering 404 keeps a caller from
      // probing another store's contents through this one.
      await WriteErrorAsync(
          context,
          StatusCodes.Status404NotFound,
          "not found\n");
      return;
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
          "delete failed\n");
      return;
    }

    context.Response.ContentType = "application/json";
    await context.Response.WriteAsync(
        "{\"success\":1}\n",
        context.RequestAborted);
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
      var request = JsonSerializer.Deserialize<DeleteRequest>(
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

  private sealed class DeleteRequest
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
