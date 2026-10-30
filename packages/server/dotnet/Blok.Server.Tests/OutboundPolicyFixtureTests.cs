using System.Net;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Outbound;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/outbound-policy.json, which the
/// Go server reads too: what GuardedOutboundPolicy allows, for URLs and for
/// the edges of every forbidden range. The conformance build swaps this policy,
/// so no black-box test can reach it. C# is the reference; run with
/// BLOK_WRITE_FIXTURES=1 to rewrite the answers after a deliberate change.
/// </summary>
public sealed class OutboundPolicyFixtureTests
{
  private static readonly GuardedOutboundPolicy Policy = new();

  private static JsonObject Validate(string raw, Uri? baseUrl)
  {
    try
    {
      var target = Policy.Validate(raw, baseUrl);

      return new JsonObject
      {
        ["allowed"] = true,
        ["url"] = target.Url.AbsoluteUri,
        ["host"] = target.Host,
        ["port"] = target.Port,
        ["literal"] = target.LiteralAddress?.ToString(),
      };
    }
    catch (GuardedFetchException)
    {
      return new JsonObject { ["allowed"] = false };
    }
  }

  [Fact]
  public void PolicyAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/outbound-policy.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonObject
    {
      ["ips"] = new JsonArray(fixture["ips"]!.AsArray()
          .Select(ip => (JsonNode)JsonValue.Create(Policy.IsAddressAllowed(IPAddress.Parse(ip!.GetValue<string>()))))
          .ToArray()),
      ["urls"] = new JsonArray(fixture["urls"]!.AsArray()
          .Select(url => (JsonNode)Validate(url!.GetValue<string>(), null))
          .ToArray()),
      ["relative"] = new JsonArray(fixture["relative"]!.AsArray()
          .Select(pair => (JsonNode)Validate(pair![1]!.GetValue<string>(), new Uri(pair[0]!.GetValue<string>())))
          .ToArray()),
    };

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
}
