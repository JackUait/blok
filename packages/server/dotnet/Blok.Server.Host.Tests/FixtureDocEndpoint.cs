using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Blok.Server.Host.Tests;

internal sealed record RecordedPut(
    string DocId,
    IReadOnlyDictionary<string, string> Headers,
    JsonNode? Body);

/// <summary>
/// A loopback stand-in for the consumer's document routes (the C# twin of
/// test/unit/server-conformance/doc-endpoint.ts): rooms GET {Url}/{docId} to
/// seed and PUT the same path to export. GETs answer a bare JSON null — the
/// endpoint's "nothing saved yet" — unless <see cref="GetStatus"/> is set.
/// </summary>
internal sealed class FixtureDocEndpoint : IAsyncDisposable
{
  private readonly WebApplication app;
  private readonly List<RecordedPut> puts = [];

  private FixtureDocEndpoint(WebApplication app, string url)
  {
    this.app = app;
    Url = url;
  }

  /// <summary>The --doc-endpoint value; documents live one path segment below it.</summary>
  internal string Url { get; }

  /// <summary>When set, every GET answers this status with an empty body instead of null.</summary>
  internal int? GetStatus { get; set; }

  internal IReadOnlyList<RecordedPut> Puts
  {
    get
    {
      lock (puts)
      {
        return [.. puts];
      }
    }
  }

  internal static async Task<FixtureDocEndpoint> StartAsync()
  {
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
    builder.Logging.ClearProviders();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    var app = builder.Build();
    FixtureDocEndpoint? endpoint = null;

    app.MapGet("/docs/{docId}", (HttpContext context) =>
    {
      if (endpoint!.GetStatus is { } status)
      {
        context.Response.StatusCode = status;

        return Task.CompletedTask;
      }

      context.Response.ContentType = "application/json; charset=utf-8";

      return context.Response.WriteAsync("null");
    });
    app.MapPut("/docs/{docId}", async (HttpContext context, string docId) =>
    {
      var body = await JsonNode.ParseAsync(context.Request.Body);
      var headers = context.Request.Headers.ToDictionary(
          header => header.Key.ToLowerInvariant(),
          header => header.Value.ToString(),
          StringComparer.Ordinal);

      lock (endpoint!.puts)
      {
        endpoint.puts.Add(new RecordedPut(docId, headers, body));
      }

      context.Response.StatusCode = StatusCodes.Status204NoContent;
    });

    await app.StartAsync();
    endpoint = new FixtureDocEndpoint(app, $"{app.Urls.Single()}/docs");

    return endpoint;
  }

  public async ValueTask DisposeAsync()
  {
    await app.DisposeAsync();
  }
}
