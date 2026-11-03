using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.FrameCheck;
using Blok.Server.Outbound;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Blok.Server.AspNetCore;

/// <summary>
/// GET /frame-check?url=: a UI hint for whether the page would let the
/// calling editor frame it. Never a security decision: it cannot see
/// cookies, the full ancestor chain or script frame-busting.
/// </summary>
internal static class FrameCheckEndpoint
{
  // 256 KiB of page is enough for the head. Truncated, never failed.
  private static readonly GuardedFetchLimits Limits = new(
      TimeSpan.FromSeconds(10),
      256L << 10,
      5,
      TruncateBody: true);

  private static readonly string[] FramingHeaders =
  [
    "Content-Security-Policy",
    "X-Frame-Options",
  ];

  internal static async Task HandleAsync(HttpContext context)
  {
    // The verdict depends on the caller's Origin, even when none was sent.
    if (!context.Response.Headers.Vary.Contains("Origin"))
    {
      context.Response.Headers.Append("Vary", "Origin");
    }

    var target = context.Request.Query["url"].FirstOrDefault() ?? "";
    if (target == "")
    {
      await WriteAsync(
          context,
          StatusCodes.Status400BadRequest,
          new FrameCheckResponse(FrameCheckVerdict.Unknown));
      return;
    }

    GuardedResponse response;

    try
    {
      var fetcher = context.RequestServices
          .GetRequiredService<IGuardedOutboundFetcher>();
      response = await fetcher.GetAsync(
          target,
          Limits with { AllowHop = context.Features.Get<HopBudgetFeature>()?.AllowHop },
          context.RequestAborted);
    }
    catch (GuardedFetchException)
    {
      await WriteAsync(
          context,
          StatusCodes.Status200OK,
          new FrameCheckResponse(FrameCheckVerdict.Unknown));
      return;
    }

    await using var ownedResponse = response;

    if (response.StatusCode is < 200 or > 299)
    {
      await WriteAsync(
          context,
          StatusCodes.Status200OK,
          new FrameCheckResponse(FrameCheckVerdict.Unknown));
      return;
    }

    var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
    var origin = BlokServerCors.RequestOrigin(context.Request);
    var embedder = BlokServerCors.IsAllowed(origin, options.AllowedOrigins)
      ? origin
      : null;
    var headers = FramingHeaders
        .SelectMany(name => response.HeaderValues(name)
            .Select(value => new KeyValuePair<string, string>(name, value)))
        .ToList();

    await WriteAsync(
        context,
        StatusCodes.Status200OK,
        new FrameCheckResponse(
            FrameCheckVerdict.Evaluate(response.FinalUrl, embedder, headers),
            response.FinalUrl));
  }

  private static Task WriteAsync(
      HttpContext context,
      int statusCode,
      FrameCheckResponse response)
  {
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "application/json";
    return context.Response.WriteAsync(
        JsonSerializer.Serialize(response) + "\n",
        context.RequestAborted);
  }

  private sealed record FrameCheckResponse(
      [property: JsonPropertyName("verdict")]
      string Verdict,
      [property: JsonPropertyName("link")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? Link = null);
}
