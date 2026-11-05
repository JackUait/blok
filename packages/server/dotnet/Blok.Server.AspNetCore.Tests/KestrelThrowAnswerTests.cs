using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

// Go and Rust copy these bytes for a handler that panics (the oracle is
// Kestrel itself, which the host runs).
public sealed class KestrelThrowAnswerTests
{
  [Fact]
  public async Task AThrowBeforeTheHeadAnswersAnEmpty500AndKeepsTheConnection()
  {
    await using var app = await StartKestrel();
    using var socket = await Connect(app);

    await Send(socket, "GET /throw HTTP/1.1\r\nHost: x\r\n\r\n");
    var first = await ReadHead(socket);
    await Send(socket, "GET /ok HTTP/1.1\r\nHost: x\r\n\r\n");
    var second = await ReadHead(socket);

    Assert.Equal(
        "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nDate: D\r\nServer: Kestrel\r\n\r\n",
        StripDate(first));
    Assert.StartsWith("HTTP/1.1 200 OK\r\n", second);
  }

  [Fact]
  public async Task AThrowAfterTheHeadClosesTheConnection()
  {
    await using var app = await StartKestrel();
    using var socket = await Connect(app);

    await Send(socket, "GET /throw-late HTTP/1.1\r\nHost: x\r\n\r\n");
    var all = await ReadToEnd(socket);

    Assert.Equal(
        "HTTP/1.1 200 OK\r\nContent-Length: 10\r\nDate: D\r\nServer: Kestrel\r\n\r\nhalf",
        StripDate(all));
  }

  private static async Task<WebApplication> StartKestrel()
  {
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
      EnvironmentName = Environments.Production,
    });
    builder.Logging.ClearProviders();
    builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
    var app = builder.Build();
    app.MapGet("/throw", (HttpContext context) =>
    {
      context.Response.Headers["X-Before"] = "1";
      throw new InvalidOperationException("boom");
    });
    app.MapGet("/throw-late", async (HttpContext context) =>
    {
      context.Response.ContentLength = 10;
      await context.Response.WriteAsync("half");
      await context.Response.Body.FlushAsync();
      throw new InvalidOperationException("boom");
    });
    app.MapGet("/ok", () => "ok");
    await app.StartAsync();
    return app;
  }

  private static async Task<Socket> Connect(WebApplication app)
  {
    var address = app.Services.GetRequiredService<IServer>()
        .Features.Get<IServerAddressesFeature>()!
        .Addresses.Single();
    var port = new Uri(address).Port;
    var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
    await socket.ConnectAsync(IPAddress.Loopback, port);
    return socket;
  }

  private static Task<int> Send(Socket socket, string text) =>
      socket.SendAsync(Encoding.ASCII.GetBytes(text));

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

    var text = head.ToString();
    if (text.StartsWith("HTTP/1.1 200", StringComparison.Ordinal))
    {
      var buffer = new byte[2];
      await socket.ReceiveAsync(buffer, timeout.Token);
    }

    return text;
  }

  private static async Task<string> ReadToEnd(Socket socket)
  {
    var all = new List<byte>();
    var buffer = new byte[4096];
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    while (true)
    {
      int read;
      try
      {
        read = await socket.ReceiveAsync(buffer, timeout.Token);
      }
      catch (SocketException)
      {
        break;
      }

      if (read == 0)
      {
        break;
      }

      all.AddRange(buffer.AsSpan(0, read).ToArray());
    }

    return Encoding.ASCII.GetString(all.ToArray());
  }

  private static string StripDate(string text) =>
      System.Text.RegularExpressions.Regex.Replace(text, "Date: [^\r]*", "Date: D");
}
