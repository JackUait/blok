using System.Reflection;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
using MediaTypeHeaderValue = Microsoft.Net.Http.Headers.MediaTypeHeaderValue;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/media-types.json, which the Go
/// server reads too. For each Content-Type it records what the upload wire
/// keeps, the multipart boundary the upload route takes, and whether the
/// JSON routes accept it. C# is the reference; run with BLOK_WRITE_FIXTURES=1
/// to rewrite the answers after a deliberate change.
/// </summary>
public sealed class MediaTypeFixtureTests
{
  private static readonly MethodInfo TryGetBoundary = typeof(BlokServerOptions).Assembly
      .GetType("Blok.Server.AspNetCore.UploadEndpoint")!
      .GetMethod("TryGetBoundary", BindingFlags.NonPublic | BindingFlags.Static)!;

  private static JsonObject Answer(string input)
  {
    var answer = new JsonObject { ["wire"] = UploadWire.SanitizeMediaType(input) };
    var arguments = new object?[] { input, null };
    answer["boundary"] = (bool)TryGetBoundary.Invoke(null, arguments)! ? (string)arguments[1]! : null;
    answer["json"] = MediaTypeHeaderValue.TryParse(input, out var parsed) &&
        string.Equals(parsed.MediaType.Value, "application/json", StringComparison.OrdinalIgnoreCase) &&
        !UploadWire.HasConflictingParameters(parsed);

    return answer;
  }

  [Fact]
  public void MediaTypeAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        OptionsValidateFixtureTests.RepositoryRoot(),
        "test/unit/server-conformance/fixtures/media-types.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray(fixture["inputs"]!.AsArray()
        .Select(input => (JsonNode)Answer(input!.GetValue<string>()))
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
