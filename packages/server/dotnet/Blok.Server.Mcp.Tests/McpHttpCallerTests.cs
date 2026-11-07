using System.Net;
using System.Net.Sockets;
using System.Text;
using Blok.Server.Mcp.Outbound;
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
}
