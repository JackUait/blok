using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// AddBlokServer keeps the caller's instance as the singleton. MapBlokServer
/// reads it once to choose the routes; the routes then read it on every
/// request, so a later change shows on the next answer.
/// </summary>
public sealed class LiveOptionsTests
{
  [Fact]
  public async Task TheRoutesAreChosenAtMapButRequestsReadTheLiveOptions()
  {
    var options = new BlokServerOptions { Version = "registered" };
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(options);
    var app = builder.Build();
    options.Version = "before-map";
    app.MapBlokServer();
    // Shapes the routes, so too late here: /unfurl stays unmapped.
    options.UnfurlDisabled = false;
    options.Version = "after-map";
    await app.StartAsync();
    using var client = app.GetTestClient();

    var first = await client.GetStringAsync("/health");
    options.Version = "after-first-request";
    var second = await client.GetStringAsync("/health");
    using var unfurl = await client.GetAsync("/unfurl?url=https://example.com/");

    Assert.Equal("{\"status\":\"ok\",\"version\":\"after-map\"}\n", first);
    Assert.Equal("{\"status\":\"ok\",\"version\":\"after-first-request\"}\n", second);
    Assert.Equal(HttpStatusCode.NotFound, unfurl.StatusCode);
    await app.StopAsync();
  }
}
