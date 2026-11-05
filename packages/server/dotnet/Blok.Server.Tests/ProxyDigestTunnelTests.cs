using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace Blok.Server.Tests;

// The Digest answer SocketsHttpHandler gives a proxy's CONNECT challenge
// (AuthenticationHelper.GetDigestTokenForCredential), which the Go and
// Rust operator clients copy. The proxy checks the response with the
// password, and the log masks the random cnonce as C and the response as R.
// Negotiate and NTLM win over Digest and Basic: .NET then sends its own
// token, never Basic.
public sealed partial class ProxyConnectTunnelTests
{
  [Theory]
  [InlineData("plain", "u", "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"")]
  [InlineData("qop", "u", "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", opaque=\"o\", algorithm=MD5, qop=auth, nc=00000001, cnonce=\"C\"")]
  [InlineData("sha-sess", "u", "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", algorithm=SHA-256-sess, qop=auth, nc=00000001, cnonce=\"C\"")]
  [InlineData("auth-int", "u", "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", algorithm=SHA-256, qop=auth-int, nc=00000001, cnonce=\"C\"")]
  [InlineData("userhash", "u", "200 ok|1 auth=no|1 auth=Digest username=\"ba84be203fdfc7d34e054a76d285d0c9\", userhash=true, realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\", algorithm=MD5")]
  [InlineData("utf8", "é", "200 ok|1 auth=no|1 auth=Digest username*=utf-8''%C3%A9, realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"")]
  [InlineData("stale", "u", "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n2\", uri=\"/\", response=\"R\"")]
  [InlineData("unsupported", "u", "error 407|1 auth=no")]
  [InlineData("digest+basic", "u", "200 ok|1 auth=no|1 auth=Digest username=\"u\", realm=\"r\", nonce=\"n\", uri=\"/\", response=\"R\"")]
  [InlineData("negotiate+basic", "u", "error 407|1 auth=no|1 auth=Negotiate T")]
  public async Task AnswersADigestChallengeAsSocketsHttpHandlerDoes(string mode, string user, string want)
  {
    using var certificate = SelfSigned();
    var target = new TcpListener(IPAddress.Loopback, 0);
    target.Start();
    _ = ServeTls(target, certificate);
    var proxy = new TcpListener(IPAddress.Loopback, 0);
    proxy.Start();
    var seen = new ConcurrentQueue<string>();
    _ = ServeDigestProxy(proxy, mode, user, ((IPEndPoint)target.LocalEndpoint).Port, seen);

    using var handler = new SocketsHttpHandler
    {
      Proxy = new WebProxy($"http://127.0.0.1:{((IPEndPoint)proxy.LocalEndpoint).Port}")
      {
        Credentials = new NetworkCredential(user, "p"),
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
    var got = string.Join("|", new[] { outcome }.Concat(seen));
    if (mode == "negotiate+basic" && !OperatingSystem.IsMacOS())
    {
      // Only macOS uses the managed SPNEGO and NTLM (NegotiateAuthenticationPal
      // UseManagedNtlm); elsewhere GSSAPI decides whether a token goes out.
      // Basic never does.
      Assert.StartsWith("error 407|1 auth=no", got, StringComparison.Ordinal);
      Assert.DoesNotContain("Basic", got, StringComparison.Ordinal);
      return;
    }

    Assert.Equal(want, got);
  }

  private static string DigestChallenge(string mode, bool second) => mode switch
  {
    "plain" or "utf8" => "Digest realm=\"r\", nonce=\"n\"",
    "qop" => "Digest realm=\"r\", nonce=\"n\", qop=\"auth\", algorithm=MD5, opaque=\"o\"",
    "sha-sess" => "Digest realm=\"r\", nonce=\"n\", qop=\"auth,auth-int\", algorithm=SHA-256-sess",
    "auth-int" => "Digest realm=\"r\", nonce=\"n\", qop=\"auth-int\", algorithm=SHA-256",
    "userhash" => "Digest realm=\"r\", nonce=\"n\", userhash=true, algorithm=MD5",
    "stale" => second ? "Digest realm=\"r\", nonce=\"n2\", stale=true" : "Digest realm=\"r\", nonce=\"n\"",
    "unsupported" => "Digest realm=\"r\", nonce=\"n\", algorithm=SHA-512",
    _ => "",
  };

  private static string ChallengeLines(string mode, bool second) => mode switch
  {
    "digest+basic" => "Proxy-Authenticate: Basic realm=\"r\"\r\nProxy-Authenticate: Digest realm=\"r\", nonce=\"n\"\r\n",
    "negotiate+basic" => "Proxy-Authenticate: Negotiate\r\nProxy-Authenticate: Basic realm=\"r\"\r\n",
    _ => $"Proxy-Authenticate: {DigestChallenge(mode, second)}\r\n",
  };

  // The RFC 7616 check, with the password p. MD5 is the protocol's, not a
  // choice made here.
#pragma warning disable CA5351
  private static bool DigestValid(string header, string user)
  {
    var fields = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach (Match match in Regex.Matches(header, "([a-z*]+)=(\"[^\"]*\"|[^, ]*)"))
    {
      fields[match.Groups[1].Value] = match.Groups[2].Value.Trim('"');
    }

    var algorithm = fields.GetValueOrDefault("algorithm", "MD5");
    string Hash(string data) => Convert.ToHexStringLower(algorithm.StartsWith("SHA-256", StringComparison.Ordinal)
      ? SHA256.HashData(Encoding.UTF8.GetBytes(data))
      : MD5.HashData(Encoding.UTF8.GetBytes(data)));
    var nonce = fields["nonce"];
    var a1 = Hash($"{user}:r:p");
    if (algorithm.EndsWith("-sess", StringComparison.Ordinal))
    {
      a1 = Hash($"{a1}:{nonce}:{fields["cnonce"]}");
    }

    var a2 = Hash(fields.GetValueOrDefault("qop") == "auth-int" ? $"CONNECT:/:{Hash("")}" : "CONNECT:/");
    var want = fields.TryGetValue("qop", out var qop)
      ? Hash($"{a1}:{nonce}:{fields["nc"]}:{fields["cnonce"]}:{qop}:{a2}")
      : Hash($"{a1}:{nonce}:{a2}");
    return fields["uri"] == "/" && fields["response"] == want;
  }
#pragma warning restore CA5351

  private static string Mask(string auth) =>
    Regex.Replace(Regex.Replace(auth, "response=\"[0-9a-f]+\"", "response=\"R\""), "cnonce=\"[0-9A-Za-z]{16}\"", "cnonce=\"C\"");

  private static async Task ServeDigestProxy(TcpListener listener, string mode, string user, int targetPort, ConcurrentQueue<string> seen)
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
        var digests = 0;
        for (var round = 0; round < 4; round++)
        {
          var head = await ReadHead(stream);
          if (head is null)
          {
            return;
          }

          var auth = head.Split("\r\n")
              .FirstOrDefault(line => line.StartsWith("Proxy-Authorization:", StringComparison.OrdinalIgnoreCase))?["Proxy-Authorization:".Length..].Trim();
          var logged = auth is null ? "no"
            : auth.StartsWith("Negotiate ", StringComparison.Ordinal) ? "Negotiate T"
            : Mask(auth);
          seen.Enqueue(string.Create(CultureInfo.InvariantCulture, $"{id} auth={logged}"));
          var digest = auth?.StartsWith("Digest ", StringComparison.Ordinal) == true;
          if (digest)
          {
            digests++;
          }

          var stale = mode == "stale" && digests == 1;
          if (digest && !stale && DigestValid(auth!, user))
          {
            await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 Connection established\r\n\r\n"));
            using var upstream = new TcpClient();
            await upstream.ConnectAsync(IPAddress.Loopback, targetPort);
            var remote = upstream.GetStream();
            await Task.WhenAny(stream.CopyToAsync(remote), remote.CopyToAsync(stream));
            return;
          }

          await stream.WriteAsync(Encoding.ASCII.GetBytes(
              "HTTP/1.1 407 Proxy Authentication Required\r\n" + ChallengeLines(mode, stale) + "Content-Length: 0\r\n\r\n"));
        }
      });
    }
  }
}
