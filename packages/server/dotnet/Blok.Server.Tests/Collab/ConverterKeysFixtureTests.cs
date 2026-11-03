using System.Globalization;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The key sets and GB9c tables in fixtures/converter-keys.json, which the
/// client tests and the Go server read too. Each side asserts its own copy
/// equals the file, so no test has to parse another language's source.
/// </summary>
public sealed class ConverterKeysFixtureTests
{
  private static readonly JsonNode Fixture = RichTextFixtures.ReadJson("converter-keys.json");

  [Fact]
  public void TheKeySetsMatchTheFixture()
  {
    Assert.Equal(Strings("diffableTextKeys"), YDocConverter.DiffableTextKeys);
    Assert.Equal(Strings("orderedIdArrayKeys"), YDocConverter.OrderedIdArrayKeys);
  }

  [Fact]
  public void TheConjunctTablesMatchTheFixture()
  {
    Assert.Equal(Bounds("conjunctLinkers"), TextDiff.ConjunctLinkers);
    Assert.Equal(Bounds("conjunctConsonants"), TextDiff.ConjunctConsonants);
    Assert.Equal(Bounds("conjunctBreakers"), TextDiff.ConjunctBreakers);
  }

  private static string[] Strings(string name)
  {
    return Fixture[name]!.AsArray().Select(key => key!.GetValue<string>()).ToArray();
  }

  private static int[] Bounds(string name)
  {
    return Fixture[name]!.AsArray()
        .SelectMany(range => range!.GetValue<string>().Split('-'))
        .Select(bound => int.Parse(bound, NumberStyles.HexNumber, CultureInfo.InvariantCulture))
        .ToArray();
  }
}
