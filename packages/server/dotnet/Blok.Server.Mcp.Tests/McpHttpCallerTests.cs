using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Mcp.Sources;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>Outbound header values as Node's fetch (undici) sends or refuses them.</summary>
public sealed class McpHttpCallerTests
{
  // One HTTP/1.1 exchange on loopback: returns the request head's raw bytes, or null when none came.
  private static async Task<(byte[]? Head, Exception? Error)> SendAsync(string value)
  {
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    var accepted = Task.Run(async () =>
    {
      using var client = await listener.AcceptTcpClientAsync();
      var stream = client.GetStream();
      var head = new MemoryStream();
      var buffer = new byte[4096];

      while (!Encoding.Latin1.GetString(head.ToArray()).Contains("\r\n\r\n", StringComparison.Ordinal))
      {
        var read = await stream.ReadAsync(buffer);

        if (read == 0)
        {
          break;
        }
        head.Write(buffer, 0, read);
      }
      await stream.WriteAsync("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{}"u8.ToArray());

      return head.ToArray();
    });
    using var caller = new McpHttpCaller();

    try
    {
      await caller.SendAsync(new McpHttpRequest("GET", $"http://127.0.0.1:{port}/docs/a", [new("Authorization", value)]), TimeSpan.FromSeconds(5));
    }
    catch (McpUnreachableException error)
    {
      listener.Stop();

      return (accepted.IsCompletedSuccessfully ? accepted.Result : null, error);
    }

    return (await accepted.WaitAsync(TimeSpan.FromSeconds(5)), null);
  }

  // undici refuses CR, LF and NUL inside a value, and any char past U+00FF: the call is never sent.
  [Theory]
  [InlineData("Bearer z\r\nX-Injected: 1")]
  [InlineData("Bearer z\nX-Injected: 1")]
  [InlineData("Bearer z\rX")]
  [InlineData("Bearer \0z")]
  [InlineData("Bearer Ā")]
  [InlineData("Bearer \U0001F600")]
  public async Task RefusesAValueUndiciRefuses(string value)
  {
    var (head, error) = await SendAsync(value);

    Assert.NotNull(error);
    Assert.True(head is null || !Encoding.Latin1.GetString(head).Contains("Authorization", StringComparison.Ordinal));
  }

  // undici strips leading and trailing tabs, spaces, CR and LF, and sends U+0080..U+00FF as Latin-1 bytes.
  [Theory]
  [InlineData("Bearer z\n", "Bearer z")]
  [InlineData(" \tBearer z\r\n", "Bearer z")]
  [InlineData("Bearer café", "Bearer café")]
  public async Task SendsAValueAsUndiciDoes(string value, string sent)
  {
    var (head, error) = await SendAsync(value);

    Assert.Null(error);
    Assert.Contains($"\r\nAuthorization: {sent}\r\n", Encoding.Latin1.GetString(head!), StringComparison.Ordinal);
  }

  // One loopback exchange that answers `answer`: the request head's text and what `act` returned.
  private static async Task<(string Head, T Result)> ServeOnceAsync<T>(byte[] answer, Func<int, Task<T>> act)
  {
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    var accepted = Task.Run(async () =>
    {
      using var client = await listener.AcceptTcpClientAsync();
      var stream = client.GetStream();
      var head = new MemoryStream();
      var buffer = new byte[4096];

      while (!Encoding.Latin1.GetString(head.ToArray()).Contains("\r\n\r\n", StringComparison.Ordinal))
      {
        var read = await stream.ReadAsync(buffer);

        if (read == 0)
        {
          break;
        }
        head.Write(buffer, 0, read);
      }
      await stream.WriteAsync(answer);

      return Encoding.Latin1.GetString(head.ToArray());
    });
    var result = await act(port);

    return (await accepted.WaitAsync(TimeSpan.FromSeconds(5)), result);
  }

  private static byte[] Answer(byte[] body, string? encoding = null)
  {
    var head = $"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n{(encoding is null ? string.Empty : $"content-encoding: {encoding}\r\n")}content-length: {body.Length}\r\nconnection: close\r\n\r\n";

    return [.. Encoding.ASCII.GetBytes(head), .. body];
  }

  private static async Task<(string Head, string Body)> GetAsync(byte[] answer)
  {
    using var caller = new McpHttpCaller();

    return await ServeOnceAsync(answer, async port =>
        (await caller.SendAsync(new McpHttpRequest("GET", $"http://127.0.0.1:{port}/docs/a", []), TimeSpan.FromSeconds(5))).Body);
  }

  // fetch's text() drops a leading BOM.
  [Fact]
  public async Task DropsALeadingByteOrderMark()
  {
    var (_, body) = await GetAsync(Answer([0xEF, 0xBB, 0xBF, .. "{\"a\":1}"u8.ToArray()]));

    Assert.Equal("{\"a\":1}", body);
  }

  // undici asks for gzip and deflate and reads either.
  [Theory]
  [InlineData("gzip")]
  [InlineData("deflate")]
  public async Task AsksForAndReadsACompressedBody(string encoding)
  {
    var packed = new MemoryStream();

    using (Stream writer = encoding == "gzip" ? new GZipStream(packed, CompressionLevel.Fastest, leaveOpen: true) : new ZLibStream(packed, CompressionLevel.Fastest, leaveOpen: true))
    {
      writer.Write("{\"a\":\"\u00e9\"}"u8);
    }
    var (head, body) = await GetAsync(Answer(packed.ToArray(), encoding));

    Assert.Equal("{\"a\":\"\u00e9\"}", body);
    Assert.Contains("\r\nAccept-Encoding: gzip, deflate\r\n", head, StringComparison.Ordinal);
  }

  // Node's url.replace(/\/$/, '') drops one trailing slash only.
  [Fact]
  public async Task KeepsAllButOneTrailingSlashOfTheEndpointUrl()
  {
    using var caller = new McpHttpCaller();
    var (head, _) = await ServeOnceAsync(Answer("{\"blocks\":[]}"u8.ToArray()), async port =>
        await new EndpointSource(new McpSourceConfig.Endpoint($"http://127.0.0.1:{port}/docs//", "Token x", null), caller).LoadAsync("a", CancellationToken.None));

    Assert.StartsWith("GET /docs//a HTTP/1.1", head, StringComparison.Ordinal);
  }
}
