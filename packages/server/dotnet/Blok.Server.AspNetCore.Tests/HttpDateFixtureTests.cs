using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Net.Http.Headers;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/http-dates.json, which the Go
/// server reads too. Each input is what HeaderUtilities.TryParseDate makes of
/// it: null when it fails, else the instant in Unix seconds. LocalFileEndpoint
/// parses If-Modified-Since, If-Unmodified-Since and If-Range with it. Run with
/// BLOK_WRITE_FIXTURES=1 to rewrite the answers.
/// </summary>
public sealed class HttpDateFixtureTests
{
  [Fact]
  public void HttpDateAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        OptionsValidateFixtureTests.RepositoryRoot(),
        "test/unit/server-conformance/fixtures/http-dates.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray(fixture["inputs"]!.AsArray()
        .Select(input => HeaderUtilities.TryParseDate(input!.GetValue<string>(), out var date)
          ? (JsonNode)JsonValue.Create(date.ToUnixTimeSeconds())
          : null)
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
