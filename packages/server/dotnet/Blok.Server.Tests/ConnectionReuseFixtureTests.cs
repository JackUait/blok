using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/outbound-conn-reuse.json,
/// which Go and Rust read too. Each case is one answer, sent raw; "close"
/// makes the server hang up after it. Two drivers log which conn each
/// request came on:
/// - tunnel: the answer is a proxy's 407 Basic challenge to a CONNECT, and
///   the retry with credentials gets a 403;
/// - plain: the answer goes to a direct GET, whose body is read, and a
///   second GET follows.
/// Each char of an answer is one byte; {PAD:n} is n 'a' bytes.
/// Run with BLOK_WRITE_FIXTURES=1 to rewrite the answers.
/// </summary>
public sealed class ConnectionReuseFixtureTests
{
  private const string Forbidden = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
  private const string Ok = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n";

  [Fact]
  public async Task ConnectionReuseMatchesTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/outbound-conn-reuse.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray();
    foreach (var entry in fixture["cases"]!.AsArray())
    {
      var answer = Expand(entry!["answer"]!.GetValue<string>());
      var close = entry["close"]?.GetValue<bool>() ?? false;
      answers.Add(new JsonObject
      {
        ["tunnel"] = await Tunnel(answer, close),
        ["plain"] = await Plain(answer, close),
      });
    }

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1")
    {
      fixture["answers"] = answers;
      File.WriteAllText(
          path,
          fixture.ToJsonString(new JsonSerializerOptions
          {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
          }) + "\n");
      return;
    }

    Assert.Equal(fixture["answers"]!.ToJsonString(), answers.ToJsonString());
  }

  // .NET retries a request only when no byte of its answer came
  // (HttpConnection.SendAsync sets _canRetry only on an empty read buffer).
  // The Go twin is TestABadHeadOnAReusedConnIsNotSentAgain.
  [Theory]
  [InlineData("malformed", "GET")]
  [InlineData("malformed", "HEAD")]
  [InlineData("truncated", "GET")]
  [InlineData("truncated", "HEAD")]
  [InlineData("big", "GET")]
  [InlineData("big", "HEAD")]
  public async Task ABadHeadOnAReusedConnIsNotSentAgain(string bad, string method)
  {
    var second = bad switch
    {
      "malformed" => "HTTP/1.1 200 OK\r\nbad line\r\n\r\n",
      "truncated" => "HTTP/1.1 200 OK\r\nContent-Le",
      _ => "HTTP/1.1 200 OK\r\nX-Big: " + new string('a', 70 << 10) + "\r\n\r\n",
    };
    var seen = new ConcurrentQueue<string>();
    var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    _ = Serve(listener, seen, first => first ? Ok : second, closeAfterSecond: true);
    using var client = new HttpClient(new SocketsHttpHandler()) { Timeout = TimeSpan.FromSeconds(10) };
    var outcomes = new List<string>();
    for (var n = 0; n < 2; n++)
    {
      try
      {
        using var request = new HttpRequestMessage(new HttpMethod(method), $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/");
        using var response = await client.SendAsync(request);
        await response.Content.ReadAsByteArrayAsync();
        outcomes.Add($"{(int)response.StatusCode}");
      }
      catch (HttpRequestException)
      {
        outcomes.Add("error");
      }
    }

    listener.Stop();
    Assert.Equal($"200|error|1 {method}|1 {method}", string.Join("|", outcomes.Concat(seen)));
  }

  private static string Expand(string answer) => Regex.Replace(
      answer,
      @"\{PAD:(\d+)\}",
      match => new string('a', int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture)));

  private static async Task<string> Tunnel(string answer, bool close)
  {
    var seen = new ConcurrentQueue<string>();
    var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    _ = Serve(listener, seen, first => first ? answer : Forbidden, close);
    using var handler = new SocketsHttpHandler
    {
      Proxy = new WebProxy($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}")
      {
        Credentials = new NetworkCredential("u", "p"),
      },
    };
    using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
    string outcome;
    try
    {
      using var response = await client.GetAsync("https://localhost:1/");
      outcome = $"{(int)response.StatusCode}";
    }
    catch (HttpRequestException error)
    {
      outcome = $"error {(int?)error.StatusCode}";
    }

    listener.Stop();
    return string.Join("|", new[] { outcome }.Concat(seen));
  }

  private static async Task<string> Plain(string answer, bool close)
  {
    var seen = new ConcurrentQueue<string>();
    var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    _ = Serve(listener, seen, first => first ? answer : Ok, close);
    using var handler = new SocketsHttpHandler();
    using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
    var outcomes = new List<string>();
    for (var n = 0; n < 2; n++)
    {
      try
      {
        using var response = await client.GetAsync($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/");
        await response.Content.ReadAsByteArrayAsync();
        outcomes.Add($"{(int)response.StatusCode}");
      }
      catch (HttpRequestException)
      {
        outcomes.Add("error");
      }
    }

    listener.Stop();
    return string.Join("|", outcomes.Concat(seen));
  }

  // Serve logs "conn method" for each request and answers the first
  // request of the run with answer(true), every later one with
  // answer(false).
  private static async Task Serve(TcpListener listener, ConcurrentQueue<string> seen, Func<bool, string> answer, bool close = false, bool closeAfterSecond = false)
  {
    var connections = 0;
    var requests = 0;
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
        try
        {
          while (true)
          {
            var head = await ReadHead(stream);
            if (head is null)
            {
              return;
            }

            seen.Enqueue($"{id} {head.Split(' ')[0]}");
            var first = Interlocked.Increment(ref requests) == 1;
            await stream.WriteAsync(Encoding.Latin1.GetBytes(answer(first)));
            if (first ? close : closeAfterSecond)
            {
              return;
            }
          }
        }
        catch (IOException)
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
}
