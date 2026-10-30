using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.StaticFiles;
using Xunit;

namespace Blok.Server.AspNetCore.Tests;

/// <summary>
/// Pins test/unit/server-conformance/fixtures/content-types.json to ASP.NET's
/// FileExtensionContentTypeProvider, the table local files are served with.
/// The Go server's copy of the table is checked against the same file. Run
/// with BLOK_WRITE_FIXTURES=1 to rewrite it after an ASP.NET upgrade.
/// </summary>
public sealed class ContentTypeFixtureTests
{
  [Fact]
  public void TheTableMatchesAspNet()
  {
    var path = Path.Combine(
        OptionsValidateFixtureTests.RepositoryRoot(),
        "test/unit/server-conformance/fixtures/content-types.json");
    var table = new JsonObject();

    foreach (var (extension, type) in new FileExtensionContentTypeProvider().Mappings
        .OrderBy(entry => entry.Key, StringComparer.Ordinal))
    {
      table[extension] = type;
    }

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1")
    {
      File.WriteAllText(
          path,
          table.ToJsonString(new JsonSerializerOptions
          {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
          }) + "\n");
      return;
    }

    Assert.Equal(JsonNode.Parse(File.ReadAllText(path))!.ToJsonString(), table.ToJsonString());
  }
}
