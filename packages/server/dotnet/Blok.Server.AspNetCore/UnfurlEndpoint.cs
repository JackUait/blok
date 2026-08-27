using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Metadata;
using Blok.Server.Outbound;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore;

internal static class UnfurlEndpoint
{
  private static readonly GuardedFetchLimits Limits = new(
      TimeSpan.FromSeconds(10),
      2L << 20,
      5);

  internal static async Task HandleAsync(HttpContext context)
  {
    var target = context.Request.Query["url"].FirstOrDefault() ?? "";
    if (target == "")
    {
      await WriteAsync(
          context,
          StatusCodes.Status400BadRequest,
          new UnfurlResponse(0));
      return;
    }

    GuardedResponse response;

    try
    {
      var fetcher = context.RequestServices
          .GetRequiredService<IGuardedOutboundFetcher>();
      response = await fetcher.GetAsync(
          target,
          Limits,
          context.RequestAborted);
    }
    catch (GuardedFetchException)
    {
      await WriteAsync(
          context,
          StatusCodes.Status200OK,
          new UnfurlResponse(0));
      return;
    }

    await using var ownedResponse = response;

    if (response.StatusCode is < 200 or > 299)
    {
      await WriteAsync(
          context,
          StatusCodes.Status200OK,
          new UnfurlResponse(0));
      return;
    }

    var metadata = UnfurlMetadataParser.Parse(
        response.Body.Span,
        response.FinalUrl);
    await WriteAsync(
        context,
        StatusCodes.Status200OK,
        new UnfurlResponse(
            1,
            response.FinalUrl,
            new UnfurlMeta(
                OmitEmpty(metadata.Title),
                OmitEmpty(metadata.Description),
                new UnfurlImage(OmitEmpty(metadata.Image)),
                OmitEmpty(metadata.Favicon),
                OmitEmpty(metadata.Domain))));
  }

  private static string? OmitEmpty(string value)
  {
    return value == "" ? null : value;
  }

  private static Task WriteAsync(
      HttpContext context,
      int statusCode,
      UnfurlResponse response)
  {
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "application/json";
    return context.Response.WriteAsync(
        JsonSerializer.Serialize(response) + "\n",
        context.RequestAborted);
  }

  private sealed record UnfurlResponse(
      [property: JsonPropertyName("success")]
      int Success,
      [property: JsonPropertyName("link")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? Link = null,
      [property: JsonPropertyName("meta")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      UnfurlMeta? Meta = null);

  private sealed record UnfurlMeta(
      [property: JsonPropertyName("title")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? Title,
      [property: JsonPropertyName("description")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? Description,
      [property: JsonPropertyName("image")]
      UnfurlImage Image,
      [property: JsonPropertyName("favicon")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? Favicon,
      [property: JsonPropertyName("domain")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? Domain);

  private sealed record UnfurlImage(
      [property: JsonPropertyName("url")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? Url);
}
