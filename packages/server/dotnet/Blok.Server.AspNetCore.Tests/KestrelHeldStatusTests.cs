using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

// A status a handler sets is not an answer until the head is sent. Go
// copies these bytes for its host (the oracle is Kestrel with the host's
// 504 request timeout policy).
public sealed class KestrelHeldStatusTests
{
  [Theory]
  [InlineData("/status-throw", "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n")]
  [InlineData("/status-timeout", "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n")]
  [InlineData("/status-returns", "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n")]
  [InlineData("/status-timeout-returns", "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n")]
  [InlineData("/flushed-timeout", "HTTP/1.1 202 Accepted\r\nDate: D\r\nServer: Kestrel\r\nTransfer-Encoding: chunked\r\n\r\n")]
  [InlineData("/hdr-timeout", "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n")]
  [InlineData("/hdr-status-timeout", "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n")]
  [InlineData("/hdr-status-throw", "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n")]
  public async Task AStatusSetWithoutAWriteIsHeldUntilTheHeadGoesOut(string path, string head)
  {
    await using var app = await StartKestrel();
    using var socket = await Connect(app);

    await socket.SendAsync(Encoding.ASCII.GetBytes($"GET {path} HTTP/1.1\r\nHost: x\r\n\r\n"));

    Assert.Equal(head, StripDate(await ReadHead(socket)));
  }

  private static async Task<WebApplication> StartKestrel()
  {
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
      EnvironmentName = Environments.Production,
    });
    builder.Logging.ClearProviders();
    builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
    builder.Services.AddRequestTimeouts(timeouts => timeouts.DefaultPolicy = new RequestTimeoutPolicy
    {
      Timeout = TimeSpan.FromMilliseconds(200),
      TimeoutStatusCode = StatusCodes.Status504GatewayTimeout,
    });
    var app = builder.Build();
    app.UseRequestTimeouts();
    app.MapGet("/status-throw", (HttpContext context) =>
    {
      context.Response.StatusCode = 404;
      throw new InvalidOperationException("boom");
    });
    app.MapGet("/status-timeout", async (HttpContext context) =>
    {
      context.Response.StatusCode = 202;
      await Task.Delay(Timeout.Infinite, context.RequestAborted);
    });
    app.MapGet("/status-returns", (HttpContext context) =>
    {
      context.Response.StatusCode = 202;
      return Task.CompletedTask;
    });
    app.MapGet("/status-timeout-returns", async (HttpContext context) =>
    {
      context.Response.StatusCode = 202;
      await Task.Delay(Timeout.Infinite, context.RequestAborted).ContinueWith(_ => { }, TaskScheduler.Default);
    });
    app.MapGet("/flushed-timeout", async (HttpContext context) =>
    {
      context.Response.StatusCode = 202;
      await context.Response.Body.FlushAsync();
      await Task.Delay(Timeout.Infinite, context.RequestAborted);
    });
    // The deadline's 504 and the throw's 500 drop the handler's headers.
    app.MapGet("/hdr-timeout", async (HttpContext context) =>
    {
      context.Response.Headers["X-Probe"] = "kept";
      context.Response.ContentType = "application/json";
      await Task.Delay(Timeout.Infinite, context.RequestAborted);
    });
    app.MapGet("/hdr-status-timeout", async (HttpContext context) =>
    {
      context.Response.Headers["X-Probe"] = "kept";
      context.Response.ContentType = "application/json";
      context.Response.StatusCode = 202;
      await Task.Delay(Timeout.Infinite, context.RequestAborted);
    });
    app.MapGet("/hdr-status-throw", (HttpContext context) =>
    {
      context.Response.Headers["X-Probe"] = "kept";
      context.Response.ContentType = "application/json";
      context.Response.StatusCode = 404;
      throw new InvalidOperationException("boom");
    });
    await app.StartAsync();
    return app;
  }

  private static async Task<Socket> Connect(WebApplication app)
  {
    var address = app.Services.GetRequiredService<IServer>()
        .Features.Get<IServerAddressesFeature>()!
        .Addresses.Single();
    var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
    await socket.ConnectAsync(IPAddress.Loopback, new Uri(address).Port);
    return socket;
  }

  private static async Task<string> ReadHead(Socket socket)
  {
    var head = new StringBuilder();
    var one = new byte[1];
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    while (!head.ToString().EndsWith("\r\n\r\n", StringComparison.Ordinal))
    {
      if (await socket.ReceiveAsync(one, timeout.Token) == 0)
      {
        break;
      }

      head.Append((char)one[0]);
    }

    return head.ToString();
  }

  private static string StripDate(string text) =>
      System.Text.RegularExpressions.Regex.Replace(text, "Date: [^\r]*", "Date: D");
}
