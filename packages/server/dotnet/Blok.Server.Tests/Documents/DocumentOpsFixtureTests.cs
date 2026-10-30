using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/documents/ops.json: node:vm's
/// answer for each runtime operation, which goja (the Go jsruntime tests) and
/// Jint (here) must both give. Regenerate with
/// node scripts/generate-documents-ops-fixture.mjs.
/// </summary>
public sealed partial class DocumentOpsFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/documents/ops.json";

  private static readonly Lazy<JintBlokRuntime> Runtime = new(
      () => JintBlokRuntime.FromEmbeddedResource(poolSize: 1, timeout: TimeSpan.FromMinutes(5)));

  private static readonly Lazy<JsonArray> Cases = new(() =>
  {
    var path = Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativePath);

    return JsonNode.Parse(File.ReadAllText(path))?.AsArray()
        ?? throw new InvalidDataException($"{path} holds JSON null");
  });

  public static TheoryData<string> Names()
  {
    var names = new TheoryData<string>();

    foreach (var entry in Cases.Value)
    {
      names.Add(entry!["name"]!.GetValue<string>());
    }

    return names;
  }

  [GeneratedRegex("\"(md|html)-[a-z0-9]+-")]
  private static partial Regex ImportIds();

  [GeneratedRegex("^Promise was rejected with value (\\w+)")]
  private static partial Regex RejectedName();

  [Theory]
  [MemberData(nameof(Names))]
  public async Task MatchesNodeOnTheSharedFixture(string name)
  {
    var entry = Cases.Value.Single(entry => entry!["name"]!.GetValue<string>() == name)!;
    var op = entry["op"]!.GetValue<string>();
    var input = entry["input"]?.GetValue<string>() ?? Expand(entry["inputRecipe"]!);

    if (entry["errorName"] is JsonNode errorName)
    {
      var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
          async () => await Runtime.Value.InvokeAsync(op, input));
      var expected = errorName.GetValue<string>();

      Assert.Equal(
          expected is "SyntaxError" or "TypeError" ? BlokConversionFailure.InvalidDocument : BlokConversionFailure.Unknown,
          failure.Reason);
      Assert.Equal(expected, RejectedName().Match(failure.InnerException!.Message).Groups[1].Value);
      return;
    }

    var output = await Runtime.Value.InvokeAsync(op, input);

    if (entry["normalizeIds"]?.GetValue<bool>() == true)
    {
      output = ImportIds().Replace(output, "\"$1-X-");
    }

    if (entry["output"] is JsonNode expectedOutput)
    {
      Assert.Equal(expectedOutput.GetValue<string>(), output);
      return;
    }

    Assert.Equal(
        entry["outputSha256"]!.GetValue<string>(),
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(output))));
  }

  /// <summary>Parts are strings or { repeat, join, items }, with {i} the index.</summary>
  private static string Expand(JsonNode recipe)
  {
    var text = new StringBuilder();

    foreach (var part in recipe["parts"]!.AsArray())
    {
      if (part is JsonValue literal)
      {
        text.Append(literal.GetValue<string>());
        continue;
      }

      var items = part!["items"]!.AsArray().Select(item => item!.GetValue<string>()).ToArray();
      var join = part["join"]!.GetValue<string>();
      var repeat = part["repeat"]!.GetValue<int>();

      for (var index = 0; index < repeat; index++)
      {
        if (index > 0)
        {
          text.Append(join);
        }

        text.Append(items[index % items.Length].Replace("{i}", index.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal));
      }
    }

    return text.ToString();
  }
}
