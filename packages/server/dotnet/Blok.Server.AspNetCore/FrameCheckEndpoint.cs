using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.FrameCheck;
using Blok.Server.Metadata;
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

  private const long MaximumOEmbedBytes = 64L << 10;

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
    var started = Stopwatch.GetTimestamp();
    var allowHop = context.Features.Get<HopBudgetFeature>()?.AllowHop;
    var caller = OutboundCaller.Of(context);
    var fetcher = context.RequestServices
        .GetRequiredService<IGuardedOutboundFetcher>();

    try
    {
      response = await fetcher.GetAsync(
          target,
          Limits with { AllowHop = allowHop, Caller = caller },
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

    string verdict;
    string finalUrl;
    string oEmbedUrl;
    int redirects;

    await using (response)
    {
      if (response.StatusCode is < 200 or > 299)
      {
        await WriteAsync(
            context,
            StatusCodes.Status200OK,
            new FrameCheckResponse(FrameCheckVerdict.Unknown));
        return;
      }

      var options = context.RequestServices.GetRequiredService<BlokServerOptions>();
      var request = context.Request;
      // Self is the request's own view; forwarded-header middleware, when the
      // host adds it, changes it here but not in Go.
      var embedder = FrameCheckEmbedder.Choose(
          request.Headers.ContainsKey("Origin") ? BlokServerCors.RequestOrigin(request) : null,
          request.Headers["Sec-Fetch-Site"].FirstOrDefault() ?? "",
          request.Query["embedder"].FirstOrDefault() ?? "",
          request.Host.HasValue ? $"{request.Scheme}://{request.Host.Value}" : "",
          origin => BlokServerCors.IsAllowed(origin, options.AllowedOrigins));
      var headers = FramingHeaders
          .SelectMany(name => response.HeaderValues(name)
              .Select(value => new KeyValuePair<string, string>(name, value)))
          .ToList();

      verdict = FrameCheckVerdict.Evaluate(response.FinalUrl, embedder, headers);
      finalUrl = response.FinalUrl;
      redirects = response.Redirects;
      oEmbedUrl = UnfurlMetadataParser.Parse(response.Body.Span, response.FinalUrl).OEmbed;
    }

    // The page's slot is free again before the oEmbed fetch takes one.
    var oEmbed = await FetchOEmbedAsync(
        fetcher,
        oEmbedUrl,
        Limits.TotalTimeout - Stopwatch.GetElapsedTime(started),
        Limits.MaximumRedirects - redirects,
        allowHop,
        caller,
        context.RequestAborted);

    await WriteAsync(
        context,
        StatusCodes.Status200OK,
        new FrameCheckResponse(verdict, finalUrl, oEmbed));
  }

  // The discovered URL goes through the same guarded fetcher, on what is left
  // of the page's deadline and redirect budget, and costs one more hop.
  private static async Task<OEmbedAnswer?> FetchOEmbedAsync(
      IGuardedOutboundFetcher fetcher,
      string url,
      TimeSpan remaining,
      int redirects,
      Func<bool>? allowHop,
      string? caller,
      CancellationToken cancellationToken)
  {
    if (url == "" ||
        remaining <= TimeSpan.Zero ||
        redirects < 0 ||
        (allowHop is not null && !allowHop()))
    {
      return null;
    }

    try
    {
      await using var response = await fetcher.GetAsync(
          url,
          new GuardedFetchLimits(remaining, MaximumOEmbedBytes, redirects, allowHop, Caller: caller),
          cancellationToken);
      if (response.StatusCode is < 200 or > 299)
      {
        return null;
      }

      var answer = OEmbedAnswer.Parse(response.Body.Span);
      return answer.IsEmpty ? null : answer;
    }
    catch (GuardedFetchException)
    {
      return null;
    }
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
      string? Link = null,
      [property: JsonPropertyName("oembed")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      OEmbedAnswer? OEmbed = null);
}
