using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Outbound;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/outbound-response-heads.json,
/// which Go and Rust read too: the origin sends the case's response, and
/// the answer is what GetAsync makes of it. Each char of a response is one
/// byte on the wire; {PAD:n} is n 'a' bytes.
/// Run with BLOK_WRITE_FIXTURES=1 to rewrite the answers.
/// </summary>
public sealed partial class GuardedOutboundFetcherTests
{
  [Fact]
  public async Task ResponseHeadsMatchTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/outbound-response-heads.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray();
    foreach (var entry in fixture["cases"]!.AsArray())
    {
      answers.Add(await FetchResponse(entry!["response"]!.GetValue<string>()));
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

  private static async Task<string> FetchResponse(string response)
  {
    var wire = Regex.Replace(
        response,
        @"\{PAD:(\d+)\}",
        match => new string('a', int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture)));
    await using var origin = new LoopbackOrigin(async (request, stream, count, token) =>
    {
      await stream.WriteAsync(Encoding.Latin1.GetBytes(wire), token);
    });
    var start = $"http://127.0.0.1:{origin.Port}";
    var fetcher = new GuardedOutboundFetcher(
        new ExactOriginPolicy(start, origin.Port),
        new SequenceDnsResolver([IPAddress.Loopback]));
    try
    {
      await using var fetched = await fetcher.GetAsync(
          start + "/",
          new GuardedFetchLimits(TimeSpan.FromSeconds(2), 1024, 3),
          CancellationToken.None);
      return $"{fetched.StatusCode} ct={fetched.ContentType} " +
        $"x={string.Join("|", fetched.HeaderValues("X-Probe"))} " +
        $"b={Encoding.Latin1.GetString(fetched.Body.Span)}";
    }
    catch (GuardedFetchException error)
    {
      return error.Failure.ToString();
    }
  }
}
