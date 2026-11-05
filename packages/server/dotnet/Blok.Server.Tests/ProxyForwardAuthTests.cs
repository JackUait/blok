using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Xunit;

namespace Blok.Server.Tests;

// How SocketsHttpHandler authenticates to a proxy for a plain http target,
// which goes to the proxy as an absolute-form request, not a CONNECT. The
// Go and Rust operator clients copy it. SendWithProxyAuthAsync passes
// preAuthenticate false here too: nothing goes out before a 407 asks.
public sealed partial class ProxyConnectTunnelTests
{
  [Theory]
  [InlineData("basic", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Basic dTpw body=")]
  [InlineData("basic-close", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|2 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Basic dTpw body=")]
  [InlineData("basic", "POST", "200 ok|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=abc|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=Basic dTpw body=abc")]
  [InlineData("none", "GET", "407 |1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=")]
  [InlineData("digest", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/x?q\", response=\"R\" body=")]
  [InlineData("ntlm", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=NTLM T1 body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=NTLM T3 ok body=")]
  [InlineData("negotiate", "GET", "200 ok|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Negotiate T1 body=|1 GET http://127.0.0.1:1/x?q HTTP/1.1 auth=Negotiate T3 ok body=")]
  // auth-int hashes the body as ReadAsStringAsync reads it: charset first,
  // else a BOM, else UTF-8 with U+FFFD, then as UTF-8. The proxy logs which
  // hash it found. A charset .NET lacks throws before a second message.
  [InlineData("digest-int-invalid", "POST", "200 ok|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=a?b|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=Digest int=text body=a?b")]
  [InlineData("digest-int-latin1", "POST", "200 ok|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=?|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=Digest int=text body=?")]
  [InlineData("digest-int-bogus", "POST", "throw InvalidOperationException|1 POST http://127.0.0.1:1/x?q HTTP/1.1 auth=no body=abc")]
  public async Task AuthenticatesAForwardedRequestAsSocketsHttpHandlerDoes(string mode, string method, string want)
  {
    var proxy = new TcpListener(IPAddress.Loopback, 0);
    proxy.Start();
    var seen = new ConcurrentQueue<string>();
    _ = ServeForwardProxy(proxy, mode, seen);
    using var handler = new SocketsHttpHandler
    {
      Proxy = new WebProxy($"http://127.0.0.1:{((IPEndPoint)proxy.LocalEndpoint).Port}")
      {
        Credentials = new NetworkCredential("u", "p"),
      },
    };
    using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
    string outcome;
    try
    {
      using var request = new HttpRequestMessage(new HttpMethod(method), "http://127.0.0.1:1/x?q");
      if (method == "POST")
      {
        request.Content = new ByteArrayContent(ForwardBody(mode).Bytes);
        if (ForwardBody(mode).ContentType is { } contentType)
        {
          request.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
        }
      }

      using var response = await client.SendAsync(request);
      outcome = $"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}";
    }
    catch (HttpRequestException error)
    {
      outcome = $"error {(int?)error.StatusCode}";
    }
    catch (Exception error)
    {
      outcome = $"throw {error.GetType().Name}";
    }

    proxy.Stop();
    var got = string.Join("|", new[] { outcome }.Concat(seen));
    Assert.Equal(want, got);
  }

  // A forwarded POST's body, its Content-Type, and the text auth-int is
  // expected to hash.
  private static (byte[] Bytes, string? ContentType, string Text) ForwardBody(string mode) => mode switch
  {
    "digest-int-invalid" => ([0x61, 0xFF, 0x62], null, "a\uFFFDb"),
    "digest-int-latin1" => ([0xE9], "text/plain; charset=iso-8859-1", "\u00e9"),
    "digest-int-bogus" => ("abc"u8.ToArray(), "text/plain; charset=bogus", "abc"),
    _ => ("abc"u8.ToArray(), null, "abc"),
  };

  // Which body hash an auth-int answer used: the text, the raw bytes, or
  // neither. User u, password p.
#pragma warning disable CA5351
  private static string AuthIntHash(string header, string method, string mode)
  {
    var fields = System.Text.RegularExpressions.Regex.Matches(header, "([a-z]+)=(\"[^\"]*\"|[^, ]*)")
      .ToDictionary(m => m.Groups[1].Value, m => m.Groups[2].Value.Trim('"'), StringComparer.Ordinal);
    string Hash(byte[] data) => Convert.ToHexStringLower(System.Security.Cryptography.MD5.HashData(data));
    string HashText(string data) => Hash(Encoding.UTF8.GetBytes(data));
    string Want(string bodyHash) => HashText(
      $"{HashText("u:r:p")}:n:{fields["nc"]}:{fields["cnonce"]}:auth-int:{HashText($"{method}:/x?q:{bodyHash}")}");
    var body = ForwardBody(mode);
    return fields["response"] == Want(HashText(body.Text)) ? "text"
      : fields["response"] == Want(Hash(body.Bytes)) ? "bytes"
      : "none";
  }
#pragma warning restore CA5351

  // The RFC 7616 check for a forwarded request, user u and password p: A2
  // is the method and the path with its query. MD5 is the protocol's.
#pragma warning disable CA5351
  private static bool ForwardDigestValid(string header, string method)
  {
    string Hash(string data) => Convert.ToHexStringLower(System.Security.Cryptography.MD5.HashData(Encoding.UTF8.GetBytes(data)));
    var response = System.Text.RegularExpressions.Regex.Match(header, "response=\"([0-9a-f]+)\"").Groups[1].Value;
    return response == Hash($"{Hash("u:r:p")}:n:{Hash($"{method}:/x?q")}");
  }
#pragma warning restore CA5351

  private static async Task ServeForwardProxy(TcpListener listener, string mode, ConcurrentQueue<string> seen)
  {
    var scheme = mode == "negotiate" ? "Negotiate" : "NTLM";
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
      _ = Task.Run(async () =>
      {
        using var _ = client;
        var stream = client.GetStream();
        var state = new NtlmState();
        try
        {
          for (var round = 0; round < 4; round++)
          {
            var head = await ReadHead(stream);
            if (head is null)
            {
              return;
            }

            var lines = head.Split("\r\n");
            var length = lines.FirstOrDefault(line => line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) is { } cl
              ? int.Parse(cl["Content-Length:".Length..].Trim(), System.Globalization.CultureInfo.InvariantCulture) : 0;
            var body = new byte[length];
            await stream.ReadExactlyAsync(body);
            var auth = lines.FirstOrDefault(line => line.StartsWith("Proxy-Authorization:", StringComparison.OrdinalIgnoreCase))?["Proxy-Authorization:".Length..].Trim();
            var logged = auth is null ? "no" : Mask(auth);
            var answer = "";
            var close = false;
            var ok = false;
            if (mode is "ntlm" or "negotiate" && auth is not null)
            {
              var space = auth.IndexOf(' ', StringComparison.Ordinal);
              var (read, valid) = ReadNtlm(auth[..space], Convert.FromBase64String(auth[(space + 1)..]), state, "p");
              logged = $"{auth[..space]} {(read.Contains(" T1 ", StringComparison.Ordinal) ? "T1" : valid ? "T3 ok" : "T3 bad")}";
              ok = valid;
              if (!valid && state.Type2 is null)
              {
                state.Type2 = Type2("ntlm");
                answer = $"Proxy-Authenticate: {scheme} {Convert.ToBase64String(scheme == "Negotiate" ? SpnegoChallenge(state.Type2) : state.Type2)}\r\n";
              }
            }
            else if (mode.StartsWith("digest-int", StringComparison.Ordinal))
            {
              answer = "Proxy-Authenticate: Digest realm=\"r\", nonce=\"n\", qop=\"auth-int\"\r\n";
              if (auth is not null)
              {
                var used = AuthIntHash(auth, lines[0].Split(' ')[0], mode);
                logged = $"Digest int={used}";
                ok = used == "text";
              }
            }
            else
            {
              ok = auth is not null && (mode != "digest" || ForwardDigestValid(auth, lines[0].Split(' ')[0]));
              answer = mode switch
              {
                "basic" or "basic-close" => "Proxy-Authenticate: Basic realm=\"r\"\r\n",
                "digest" => "Proxy-Authenticate: Digest realm=\"r\", nonce=\"n\"\r\n",
                "ntlm" or "negotiate" => $"Proxy-Authenticate: {scheme}\r\n",
                _ => "",
              };
              close = mode == "basic-close";
            }

            seen.Enqueue($"{id} {lines[0]} auth={logged} body={Encoding.ASCII.GetString(body)}");
            if (ok)
            {
              await stream.WriteAsync("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"u8.ToArray());
              continue;
            }

            await stream.WriteAsync(Encoding.ASCII.GetBytes(
                "HTTP/1.1 407 Proxy Authentication Required\r\n" + answer + (close ? "Connection: close\r\n" : "") + "Content-Length: 0\r\n\r\n"));
            if (close)
            {
              return;
            }
          }
        }
        catch (Exception error)
        {
          seen.Enqueue($"{id} proxy {error.GetType().Name}");
        }
      });
    }
  }
}
