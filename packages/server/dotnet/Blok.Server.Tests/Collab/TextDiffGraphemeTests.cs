using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The atom the diff may put an edit boundary between, against what the
/// CLIENT's <c>atomize</c> answers for the same string — recorded by running
/// src/components/modules/yjs/text-diff.ts over this corpus. The two must
/// split a character alike: the server's /edit push and a browser's save
/// describe the same keystroke, and different atoms mean different ops, which
/// merge to different documents.
///
/// Runs at the C# layer against those recorded answers, not against a live
/// JavaScript engine. The live cross-check is
/// test/unit/server-conformance/server-concurrent-loss-wave2.test.ts, which
/// re-derives the GB9c tables from the client's own segmenter.
/// </summary>
public sealed class TextDiffGraphemeTests
{
  [InlineData("ASCII", "hello world", new[] { "h", "e", "l", "l", "o", " ", "w", "o", "r", "l", "d" })]
  [InlineData("ASCII markup", "<b>bold</b> &amp; plain", new[] { "<b>", "b", "o", "l", "d", "</b>", " ", "&amp;", " ", "p", "l", "a", "i", "n" })]
  [InlineData("combining acute", "e\u0301", new[] { "e\u0301" })]
  [InlineData("stacked marks", "a\u0300\u0327b", new[] { "a\u0300\u0327", "b" })]
  [InlineData("skin tone", "\uD83D\uDC4D\uD83C\uDFFF!", new[] { "\uD83D\uDC4D\uD83C\uDFFF", "!" })]
  [InlineData("ZWJ family", "x\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66y", new[] { "x", "\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66", "y" })]
  [InlineData("flag", "\uD83C\uDDEF\uD83C\uDDF5", new[] { "\uD83C\uDDEF\uD83C\uDDF5" })]
  [InlineData("two flags", "\uD83C\uDDEF\uD83C\uDDF5\uD83C\uDDE9\uD83C\uDDEA", new[] { "\uD83C\uDDEF\uD83C\uDDF5", "\uD83C\uDDE9\uD83C\uDDEA" })]
  [InlineData("tag flag", "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74\uDB40\uDC7F", new[] { "\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74\uDB40\uDC7F" })]
  [InlineData("keycap", "#\uFE0F\u20E3", new[] { "#\uFE0F\u20E3" })]
  [InlineData("CRLF", "a\u000D\u000Ab", new[] { "a", "\u000D\u000A", "b" })]
  [InlineData("Hangul jamo", "\u1100\u1161\u11A8", new[] { "\u1100\u1161\u11A8" })]
  [InlineData("Thai", "\u0E01\u0E33", new[] { "\u0E01\u0E33" })]
  [InlineData("plain emoji", "\uD83D\uDE00", new[] { "\uD83D\uDE00" })]
  [InlineData("variation selector", "\u2764\uFE0F", new[] { "\u2764\uFE0F" })]
  [InlineData("Devanagari conjunct", "\u0915\u094D\u0930", new[] { "\u0915\u094D\u0930" })]
  [InlineData("Devanagari conjunct chain", "\u0915\u094D\u0930\u094D\u092F", new[] { "\u0915\u094D\u0930\u094D\u092F" })]
  [InlineData("Devanagari double linker", "\u0915\u094D\u094D\u0930", new[] { "\u0915\u094D\u094D\u0930" })]
  [InlineData("Devanagari nukta before linker", "\u0915\u093C\u094D\u0930", new[] { "\u0915\u093C\u094D\u0930" })]
  [InlineData("Devanagari spacing mark breaks the conjunct", "\u0915\u093E\u094D\u0930", new[] { "\u0915\u093E\u094D", "\u0930" })]
  [InlineData("ZWNJ breaks the conjunct", "\u0915\u200C\u094D\u0930", new[] { "\u0915\u200C\u094D", "\u0930" })]
  [InlineData("linker after a non-consonant", "b\u094D\u0930", new[] { "b\u094D", "\u0930" })]
  [InlineData("linker before a non-consonant", "\u0915\u094Dz", new[] { "\u0915\u094D", "z" })]
  [InlineData("Bengali conjunct", "\u0995\u09CD\u09B0", new[] { "\u0995\u09CD\u09B0" })]
  [InlineData("Gujarati conjunct", "\u0A95\u0ACD\u0AB0", new[] { "\u0A95\u0ACD\u0AB0" })]
  [InlineData("Oriya conjunct", "\u0B15\u0B4D\u0B30", new[] { "\u0B15\u0B4D\u0B30" })]
  [InlineData("Telugu conjunct", "\u0C15\u0C4D\u0C30", new[] { "\u0C15\u0C4D\u0C30" })]
  [InlineData("Malayalam conjunct", "\u0D15\u0D4D\u0D30", new[] { "\u0D15\u0D4D\u0D30" })]
  [InlineData("conjunct in markup", "<i>\u0915\u094D\u0930</i>", new[] { "<i>", "\u0915\u094D\u0930", "</i>" })]
  [InlineData("conjunct beside an entity", "&amp;\u0915\u094D\u0930", new[] { "&amp;", "\u0915\u094D\u0930" })]
  [InlineData("tag then accent", "<b>\u0301x", new[] { "<b>", "\u0301", "x" })]
  // A Prepend character clusters with whatever FOLLOWS it, so a cluster could
  // otherwise swallow a complete tag and put an edit boundary inside markup.
  // The guard protects markup, not the character: a bare less-than or
  // ampersand that starts no tag or entity still clusters, which the last two
  // cases pin.
  [InlineData("Prepend before a complete tag", "\u0600<b>bold</b> tail", new[] { "\u0600", "<b>", "b", "o", "l", "d", "</b>", " ", "t", "a", "i", "l" })]
  [InlineData("Prepend before a closing tag", "\u0600</a>x", new[] { "\u0600", "</a>", "x" })]
  [InlineData("Prepend before a tag with attributes", "\u0600<a href=\"x\">y</a>", new[] { "\u0600", "<a href=\"x\">", "y", "</a>" })]
  [InlineData("Prepend before a named entity", "\u0600&amp;", new[] { "\u0600", "&amp;" })]
  [InlineData("Prepend before a numeric entity", "\u0600&#65;", new[] { "\u0600", "&#65;" })]
  [InlineData("Prepend before a bare less-than", "\u0600<x no tag", new[] { "\u0600<", "x", " ", "n", "o", " ", "t", "a", "g" })]
  [InlineData("Prepend before a bare ampersand", "\u0600&notanentity", new[] { "\u0600&", "n", "o", "t", "a", "n", "e", "n", "t", "i", "t", "y" })]
  [InlineData("Malayalam Prepend before a tag", "\u0D4E<b>x", new[] { "\u0D4E", "<b>", "x" })]
  [Theory]
  public void SplitsACharacterTheWayTheClientDoes(string name, string text, string[] expected)
  {
    Assert.Equal(expected, TextDiff.Atomize(text));
    Assert.Equal(text, string.Concat(TextDiff.Atomize(text)));
    Assert.NotEmpty(name);
  }

  /// <summary>
  /// A LONE surrogate is an atom of its own, as it is on the client: dropping
  /// or replacing it would rewrite text the caller never changed. Not a
  /// theory case — xUnit serializes theory arguments through UTF-8, which
  /// replaces an unpaired surrogate before the test ever sees it.
  /// </summary>
  [Fact]
  public void KeepsALoneSurrogateAsItsOwnAtom()
  {
    Assert.Equal(["a", "\uD83D", "b"], TextDiff.Atomize("a\uD83Db"));
  }
}
