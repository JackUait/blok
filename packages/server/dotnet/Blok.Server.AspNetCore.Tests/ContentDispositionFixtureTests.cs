using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/content-disposition-filenames.json,
/// which the Go server reads too. Each input is a part's Content-Disposition;
/// its answer is the file name UploadEndpoint keeps, or null when the part
/// is not a file. Run with BLOK_WRITE_FIXTURES=1 to rewrite the answers.
/// </summary>
public sealed class ContentDispositionFixtureTests
{
  [Fact]
  public void FileNameAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        OptionsValidateFixtureTests.RepositoryRoot(),
        "test/unit/server-conformance/fixtures/content-disposition-filenames.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var answers = new JsonArray(fixture["inputs"]!.AsArray()
        .Select(input => UploadEndpoint.TryReadFileName(input!.GetValue<string>(), out var fileName)
          ? (JsonNode)JsonValue.Create(fileName)
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
