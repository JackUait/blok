using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.FrameCheck;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/frame-check-oembed.json, which
/// the Go server reads too: what OEmbedAnswer keeps from each oEmbed JSON
/// body. C# is the reference; run with BLOK_WRITE_FIXTURES=1 to rewrite the
/// answers after a deliberate change.
/// </summary>
public sealed class FrameCheckOEmbedFixtureTests
{
  [Fact]
  public void OEmbedAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/frame-check-oembed.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray(fixture["cases"]!.AsArray()
        .Select(entry =>
        {
          var body = entry!["jsonBase64"] is { } encoded
            ? Convert.FromBase64String(encoded.GetValue<string>())
            : Encoding.UTF8.GetBytes(entry["json"]!.GetValue<string>());
          var answer = OEmbedAnswer.Parse(body);

          return (JsonNode)new JsonObject
          {
            ["title"] = answer.Title,
            ["provider_name"] = answer.ProviderName,
            ["thumbnail_url"] = answer.ThumbnailUrl,
            ["width"] = answer.Width,
            ["height"] = answer.Height,
            ["wire"] = answer.IsEmpty ? "" : JsonSerializer.Serialize(answer),
          };
        })
        .ToArray());

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
