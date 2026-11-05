using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/outbound-body-text.json,
/// which Go and Rust read too: the text Digest auth-int hashes, which is
/// HttpContent.ReadAsStringAsync over the body under its raw Content-Type.
/// Run with BLOK_WRITE_FIXTURES=1 to rewrite the answers.
/// </summary>
public sealed class BodyTextFixtureTests
{
  [Fact]
  public async Task BodyTextMatchesTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/outbound-body-text.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray();
    foreach (var entry in fixture["cases"]!.AsArray())
    {
      using var content = new ByteArrayContent(Convert.FromHexString(entry!["body"]!.GetValue<string>()));
      if (entry["contentType"]?.GetValue<string>() is { } contentType)
      {
        content.Headers.TryAddWithoutValidation("Content-Type", contentType);
      }

      try
      {
        var text = await content.ReadAsStringAsync();
        answers.Add(new JsonObject { ["text"] = Convert.ToHexStringLower(System.Text.Encoding.UTF8.GetBytes(text)) });
      }
      catch (Exception error)
      {
        answers.Add(new JsonObject { ["error"] = error.GetType().Name });
      }
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
}
