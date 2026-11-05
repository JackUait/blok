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
/// The answers are .NET's with no EncodingProvider. AngleSharp registers
/// CodePagesEncodingProvider when its default configuration is built (the
/// unfurl parser does), and from then on a code-page charset such as
/// windows-1252 reads instead of throwing. When some earlier test in this
/// process did that, those rows are skipped. Run with BLOK_WRITE_FIXTURES=1
/// in a fresh process to rewrite the answers.
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

    var cases = fixture["cases"]!.AsArray();
    var wanted = fixture["answers"]!.AsArray();
    Assert.Equal(wanted.Count, answers.Count);
    for (var index = 0; index < answers.Count; index++)
    {
      if (CodePageCharset(cases[index]!["contentType"]?.GetValue<string>()))
      {
        continue;
      }

      Assert.Equal(wanted[index]!.ToJsonString(), answers[index]!.ToJsonString());
    }
  }

  // Whether contentType names a charset only a registered
  // CodePagesEncodingProvider knows, while one is registered.
  private static bool CodePageCharset(string? contentType)
  {
    if (contentType is null ||
        !System.Net.Http.Headers.MediaTypeHeaderValue.TryParse(contentType, out var parsed) ||
        parsed.CharSet is not { } name)
    {
      return false;
    }

    try
    {
      _ = System.Text.Encoding.GetEncoding(1252);
    }
    catch (NotSupportedException)
    {
      return false;
    }

    return System.Text.CodePagesEncodingProvider.Instance.GetEncoding(name.Trim('"')) is not null;
  }
}
