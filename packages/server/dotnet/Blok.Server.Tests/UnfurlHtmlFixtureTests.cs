using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Metadata;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/unfurl-html.json, which the Go
/// server reads too: each page and final URL, and what UnfurlMetadataParser
/// makes of them. Run with BLOK_WRITE_FIXTURES=1 to rewrite the answers.
/// </summary>
public sealed class UnfurlHtmlFixtureTests
{
  [Fact]
  public void UnfurlAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/unfurl-html.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray(fixture["cases"]!.AsArray()
        .Select(entry =>
        {
          var body = entry!["htmlBase64"] is { } encoded
            ? Convert.FromBase64String(encoded.GetValue<string>())
            : Encoding.UTF8.GetBytes(entry["html"]!.GetValue<string>());
          var metadata = UnfurlMetadataParser.Parse(body, entry["url"]!.GetValue<string>());

          return (JsonNode)new JsonObject
          {
            ["title"] = metadata.Title,
            ["description"] = metadata.Description,
            ["image"] = metadata.Image,
            ["favicon"] = metadata.Favicon,
            ["domain"] = metadata.Domain,
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
