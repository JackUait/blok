using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Xunit;

namespace Blok.Server.Tests;

// How SocketsHttpHandler opens a CONNECT tunnel, which the Go and Rust
// operator clients copy (S3, doc endpoint): no credentials until a 407
// challenge asks for them, and only a 200 opens the tunnel.
public sealed partial class ProxyConnectTunnelTests
{
  [Theory]
  // A Basic challenge: the CONNECT goes out again with the credentials.
  [InlineData("challenge", "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic dTpw")]
  // A domain credential: Basic sends "domain\\user:password".
  [InlineData("challenge-domain", "200 ok|1 CONNECT auth=no|1 CONNECT auth=Basic RE9NXHU6cA==")]
  // The challenge closes its conn: the retry opens a new one.
  [InlineData("challenge-close", "200 ok|1 CONNECT auth=no|2 CONNECT auth=Basic dTpw")]
  // A 407 with no challenge .NET can answer is the answer.
  [InlineData("no-challenge", "error 407|1 CONNECT auth=no")]
  // Only 200 opens the tunnel.
  [InlineData("201", "error 201|1 CONNECT auth=no")]
  [InlineData("200", "200 ok|1 CONNECT auth=no")]
  public async Task OpensATunnelAsSocketsHttpHandlerDoes(string mode, string want)
  {
    using var certificate = SelfSigned();
    var target = new TcpListener(IPAddress.Loopback, 0);
    target.Start();
    _ = ServeTls(target, certificate);
    var proxy = new TcpListener(IPAddress.Loopback, 0);
    proxy.Start();
    var seen = new ConcurrentQueue<string>();
    _ = ServeProxy(proxy, mode, ((IPEndPoint)target.LocalEndpoint).Port, seen);

    using var handler = new SocketsHttpHandler
    {
      Proxy = new WebProxy($"http://127.0.0.1:{((IPEndPoint)proxy.LocalEndpoint).Port}")
      {
        Credentials = new NetworkCredential("u", "p", mode == "challenge-domain" ? "DOM" : ""),
      },
      SslOptions = new SslClientAuthenticationOptions
      {
        RemoteCertificateValidationCallback = (_, presented, _, _) =>
            presented is not null && presented.GetCertHashString() == certificate.GetCertHashString(),
      },
    };
    using var client = new HttpClient(handler);
    string outcome;
    try
    {
      using var response = await client.GetAsync($"https://localhost:{((IPEndPoint)target.LocalEndpoint).Port}/");
      outcome = $"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}";
    }
    catch (HttpRequestException error)
    {
      outcome = $"error {(int?)error.StatusCode}";
    }

    proxy.Stop();
    target.Stop();
    Assert.Equal(want, string.Join("|", new[] { outcome }.Concat(seen)));
  }

  private static async Task ServeProxy(TcpListener listener, string mode, int targetPort, ConcurrentQueue<string> seen)
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
      _ = Task.Run(async () =>
      {
        using var _ = client;
        var stream = client.GetStream();
        while (true)
        {
          var head = await ReadHead(stream);
          if (head is null)
          {
            return;
          }

          var lines = head.Split("\r\n");
          var auth = lines.FirstOrDefault(line => line.StartsWith("Proxy-Authorization:", StringComparison.OrdinalIgnoreCase));
          seen.Enqueue($"{id} {lines[0].Split(' ')[0]} auth={(auth is null ? "no" : auth["Proxy-Authorization:".Length..].Trim())}");
          string? answer = mode switch
          {
            "challenge" or "challenge-domain" when auth is null => "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"r\"\r\nContent-Length: 0\r\n\r\n",
            "challenge-close" when auth is null => "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"r\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "no-challenge" => "HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n",
            _ => null,
          };
          if (answer is not null)
          {
            await stream.WriteAsync(Encoding.ASCII.GetBytes(answer));
            if (answer.Contains("Connection: close", StringComparison.Ordinal))
            {
              return;
            }

            continue;
          }

          // A 201 tunnels anyway: a client that takes any 2xx gets through.
          var status = mode == "201" ? "201 Created" : "200 Connection established";
          await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\n\r\n"));
          using var upstream = new TcpClient();
          await upstream.ConnectAsync(IPAddress.Loopback, targetPort);
          var remote = upstream.GetStream();
          await Task.WhenAny(stream.CopyToAsync(remote), remote.CopyToAsync(stream));
          return;
        }
      });
    }
  }

  private static async Task ServeTls(TcpListener listener, X509Certificate2 certificate)
  {
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

      _ = Task.Run(async () =>
      {
        using var _ = client;
        await using var tls = new SslStream(client.GetStream());
        try
        {
          await tls.AuthenticateAsServerAsync(certificate);
          await ReadHead(tls);
          await tls.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"));
        }
        catch (Exception)
        {
        }
      });
    }
  }

  private static async Task<string?> ReadHead(Stream stream)
  {
    var head = new StringBuilder();
    var one = new byte[1];
    while (!head.ToString().EndsWith("\r\n\r\n", StringComparison.Ordinal))
    {
      if (await stream.ReadAsync(one) == 0)
      {
        return null;
      }

      head.Append((char)one[0]);
    }

    return head.ToString();
  }

  private static X509Certificate2 SelfSigned()
  {
    using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256);
    using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow.AddHours(1));
    return X509CertificateLoader.LoadPkcs12(certificate.Export(X509ContentType.Pfx), null);
  }
}
