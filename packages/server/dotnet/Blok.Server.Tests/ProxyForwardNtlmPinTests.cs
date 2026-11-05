using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Xunit;

namespace Blok.Server.Tests;

// SendWithNtProxyAuthAsync holds its conn for the whole handshake, so
// requests sent at once never meet on one conn mid-handshake. NTLM signs
// the conn: once a handshake ends, the proxy lets that conn through, and a
// later request reuses it with no credentials. The proxy pauses before
// each Type 2 so the handshakes overlap. Go's twin is
// TestConcurrentNtlmHandshakesEachKeepTheirConn.
public sealed partial class ProxyConnectTunnelTests
{
  [Fact]
  public async Task ConcurrentNtlmHandshakesEachKeepTheirConn()
  {
    const int requests = 6;
    var proxy = new TcpListener(IPAddress.Loopback, 0);
    proxy.Start();
    var logs = new ConcurrentDictionary<int, ConcurrentQueue<string>>();
    _ = ServePinningProxy(proxy, logs);
    using var handler = new SocketsHttpHandler
    {
      Proxy = new WebProxy($"http://127.0.0.1:{((IPEndPoint)proxy.LocalEndpoint).Port}")
      {
        Credentials = new NetworkCredential("u", "p"),
      },
    };
    using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
    var statuses = await Task.WhenAll(Enumerable.Range(0, requests).Select(async _ =>
    {
      using var response = await client.GetAsync("http://127.0.0.1:1/x");
      return (int)response.StatusCode;
    }));
    using var later = await client.GetAsync("http://127.0.0.1:1/x");
    proxy.Stop();

    if (!OperatingSystem.IsMacOS())
    {
      // Elsewhere GSSAPI or SSPI makes the token, not the managed NTLM. The
      // Linux CI image has no gss-ntlmssp, so .NET gets no further than 407.
      if (OperatingSystem.IsLinux())
      {
        Assert.All(statuses, status => Assert.Equal(407, status));
      }

      return;
    }

    Assert.All(statuses, status => Assert.Equal(200, status));
    Assert.Equal(200, (int)later.StatusCode);
    Assert.Equal(requests, logs.Count);
    var reused = 0;
    foreach (var log in logs.Values)
    {
      var events = log.ToArray();
      Assert.Equal(["no", "T1", "T3 ok"], events.Take(3));
      Assert.All(events.Skip(3), e => Assert.Equal("no authed", e));
      reused += events.Length - 3;
    }

    Assert.Equal(1, reused);
  }

  private static async Task ServePinningProxy(TcpListener listener, ConcurrentDictionary<int, ConcurrentQueue<string>> logs)
  {
    var connections = 0;
    while (true)
    {
      TcpClient client;
      try
      {
        client = await listener.AcceptTcpClientAsync();
      }
      catch (Exception)
      {
        return;
      }

      var id = Interlocked.Increment(ref connections);
      var log = logs.GetOrAdd(id, _ => new ConcurrentQueue<string>());
      _ = Task.Run(async () =>
      {
        using var _ = client;
        var stream = client.GetStream();
        var state = new NtlmState();
        var authed = false;
        while (true)
        {
          var head = await ReadHead(stream);
          if (head is null)
          {
            return;
          }

          var auth = head.Split("\r\n")
            .FirstOrDefault(line => line.StartsWith("Proxy-Authorization:", StringComparison.OrdinalIgnoreCase))?["Proxy-Authorization:".Length..].Trim();
          string answer;
          if (auth is null)
          {
            log.Enqueue(authed ? "no authed" : "no");
            answer = authed ? "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok" : "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: NTLM\r\nContent-Length: 0\r\n\r\n";
          }
          else
          {
            var space = auth.IndexOf(' ', StringComparison.Ordinal);
            var (read, valid) = ReadNtlm(auth[..space], Convert.FromBase64String(auth[(space + 1)..]), state, "p");
            if (read.Contains(" T1 ", StringComparison.Ordinal))
            {
              log.Enqueue("T1");
              await Task.Delay(150);
              state.Type2 = Type2("ntlm");
              answer = $"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: NTLM {Convert.ToBase64String(state.Type2)}\r\nContent-Length: 0\r\n\r\n";
            }
            else
            {
              log.Enqueue(valid ? "T3 ok" : "T3 bad");
              authed = valid;
              answer = valid ? "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok" : "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
            }
          }

          await stream.WriteAsync(Encoding.ASCII.GetBytes(answer));
        }
      });
    }
  }
}
