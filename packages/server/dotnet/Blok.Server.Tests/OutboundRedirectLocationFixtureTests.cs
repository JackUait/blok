using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Outbound;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/outbound-redirect-locations.json,
/// which Go and Rust read too: a 302 with the listed Location lines, and what
/// GetAsync makes of it. A Location .NET cannot parse makes the 302 final.
/// Each char of a location is one byte on the wire; PORT is the origin's port.
/// Run with BLOK_WRITE_FIXTURES=1 to rewrite the answers.
/// </summary>
public sealed partial class GuardedOutboundFetcherTests
{
  [Fact]
  public async Task RedirectLocationsMatchTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/outbound-redirect-locations.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray();
    foreach (var entry in fixture["cases"]!.AsArray())
    {
      var locations = entry!["locations"]!.AsArray().Select(value => value!.GetValue<string>()).ToArray();
      answers.Add(await FetchRedirect(locations));
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

  private static async Task<string> FetchRedirect(string[] locations)
  {
    var port = 0;
    await using var origin = new LoopbackOrigin(async (request, stream, count, token) =>
    {
      var portText = port.ToString(CultureInfo.InvariantCulture);
      var head = request.Target == "/start"
        ? "HTTP/1.1 302 Found\r\n" +
          string.Concat(locations.Select(location => $"Location: {location.Replace("PORT", portText, StringComparison.Ordinal)}\r\n")) +
          "Content-Length: 0\r\nConnection: close\r\n\r\n"
        : "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
      await stream.WriteAsync(Encoding.Latin1.GetBytes(head), token);
    });
    port = origin.Port;
    var start = $"http://127.0.0.1:{port}";
    var fetcher = new GuardedOutboundFetcher(
        new ExactOriginPolicy(start, port),
        new SequenceDnsResolver([IPAddress.Loopback]));
    try
    {
      await using var response = await fetcher.GetAsync(
          start + "/start",
          new GuardedFetchLimits(TimeSpan.FromSeconds(2), 1024, 3),
          CancellationToken.None);
      return response.StatusCode == 302
        ? "302"
        : $"{response.StatusCode} {response.FinalUrl[start.Length..].Replace(port.ToString(CultureInfo.InvariantCulture), "PORT", StringComparison.Ordinal)}";
    }
    catch (GuardedFetchException error)
    {
      return error.Failure.ToString();
    }
  }

  /// <summary>The conformance build's ExactOriginOutboundPolicy.</summary>
  private sealed class ExactOriginPolicy(string origin, int port) : IGuardedOutboundPolicy
  {
    public GuardedTarget Validate(string rawUrl, Uri? baseUrl = null)
    {
      var parsed = baseUrl is null
        ? Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)
        : Uri.TryCreate(baseUrl, rawUrl, out url);
      var original = url?.OriginalString ?? "";
      if (!parsed ||
          url is null ||
          url.Scheme != Uri.UriSchemeHttp ||
          url.Host != "127.0.0.1" ||
          url.Port != port ||
          url.UserInfo != "" ||
          !original.StartsWith(origin, StringComparison.Ordinal) ||
          (original.Length > origin.Length && !"/?#".Contains(original[origin.Length], StringComparison.Ordinal)))
      {
        throw new GuardedFetchException(GuardedFetchFailure.BlockedDestination);
      }

      return new GuardedTarget(url, "127.0.0.1", port, IPAddress.Loopback);
    }

    public bool IsAddressAllowed(IPAddress address) => address.Equals(IPAddress.Loopback);
  }
}
