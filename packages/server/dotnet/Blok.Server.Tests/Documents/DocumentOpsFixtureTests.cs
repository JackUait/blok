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
      var expected = expectedOutput.GetValue<string>();

      if (name.StartsWith("lone.", StringComparison.Ordinal))
      {
        expected = ReadLoneSurrogatesAsGoDoes(expected);
      }

      Assert.Equal(expected, output);
      return;
    }

    Assert.Equal(
        entry["outputSha256"]!.GetValue<string>(),
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(output))));
  }

  [GeneratedRegex("\\\\u[dD][89a-fA-F][0-9a-fA-F]{2}")]
  private static partial Regex SurrogateEscape();

  /// <summary>
  /// Node keeps a lone-surrogate escape; goja reads it as U+FFFD, and the C#
  /// runtime reads input the same way. A high escape right before a low escape
  /// is a pair and stays. Mirrors gojaReadsLoneSurrogates in ops_fixture_test.go.
  /// </summary>
  private static string ReadLoneSurrogatesAsGoDoes(string expected)
  {
    var matches = SurrogateEscape().Matches(expected);
    bool High(int i) => "89abAB".Contains(expected[matches[i].Index + 3], StringComparison.Ordinal);
    var text = new StringBuilder();
    var last = 0;

    for (var i = 0; i < matches.Count; i++)
    {
      var paired = High(i) && i + 1 < matches.Count
          && matches[i + 1].Index == matches[i].Index + matches[i].Length && !High(i + 1);

      text.Append(expected, last, matches[i].Index - last);

      if (paired)
      {
        text.Append(expected, matches[i].Index, matches[i].Length + matches[i + 1].Length);
        last = matches[i + 1].Index + matches[i + 1].Length;
        i++;
        continue;
      }

      text.Append('\ufffd');
      last = matches[i].Index + matches[i].Length;
    }

    return text.Append(expected, last, expected.Length - last).ToString();
  }

  private static readonly Lazy<JintBlokRuntime> SixtyFourMiBRuntime = new(
      () => JintBlokRuntime.FromEmbeddedResource(
          poolSize: 1,
          timeout: TimeSpan.FromMinutes(5),
          allocationBudgetBytes: 64L * 1024 * 1024));

  /*
   * C# only. Go and Rust count memory differently (live heap, QuickJS
   * allocations), so their refusal points differ; at the default budget
   * all three convert these: MatchesNodeOnTheSharedFixture.
   */
  [Theory]
  [InlineData("big.plain.text", false)]
  [InlineData("big.plain.markdown", true)]
  [InlineData("big.plain.html", false)]
  [InlineData("big.marked.text", true)]
  [InlineData("big.marked.markdown", true)]
  [InlineData("big.marked.html", true)]
  [InlineData("big.marked.pageIndex", true)]
  [InlineData("big.marked.extract", false)]
  [InlineData("big.url.image.markdown", true)]
  [InlineData("big.url.bookmark.markdown", true)]
  [InlineData("big.fromMarkdown", true)]
  public async Task StopsTheBigDocumentsOfTheSharedFixtureAt64MiB(string name, bool stopped)
  {
    var entry = Cases.Value.Single(entry => entry!["name"]!.GetValue<string>() == name)!;
    var op = entry["op"]!.GetValue<string>();
    var input = Expand(entry["inputRecipe"]!);

    if (!stopped)
    {
      await SixtyFourMiBRuntime.Value.InvokeAsync(op, input);
      return;
    }

    var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        async () => await SixtyFourMiBRuntime.Value.InvokeAsync(op, input));
    Assert.Equal(BlokConversionFailure.DocumentTooLarge, failure.Reason);
  }

  /*
   * One 32 MiB base64 image at the default budget: Markdown is refused,
   * plain text and HTML convert (the shared big.default.image.32mib cases).
   */
  [Theory]
  [InlineData("blocksToMarkdown", true)]
  [InlineData("blocksToPlainText", false)]
  [InlineData("blocksToHtml", false)]
  public async Task ConvertsA32MiBImageAtTheDefaultBudget(string op, bool stopped)
  {
    var input = "{\"blocks\":[{\"id\":\"u1\",\"type\":\"image\",\"data\":{\"url\":\"data:image/png;base64,"
        + new string('A', 32 * 1024 * 1024) + "\"}}]}";

    if (!stopped)
    {
      await Runtime.Value.InvokeAsync(op, input);
      return;
    }

    var failure = await Assert.ThrowsAsync<BlokDocumentConversionException>(
        async () => await Runtime.Value.InvokeAsync(op, input));
    Assert.Equal(BlokConversionFailure.DocumentTooLarge, failure.Reason);
  }

  /// <summary>Parts are strings or { repeat, join, items }, with {i} the index and {i1} the index plus one.</summary>
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

        text.Append(items[index % items.Length]
            .Replace("{i}", index.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{i1}", (index + 1).ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal));
      }
    }

    return text.ToString();
  }
}
