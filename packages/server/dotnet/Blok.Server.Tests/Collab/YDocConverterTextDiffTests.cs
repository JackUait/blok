using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The edit a host pushes through /edit has to merge with a peer's concurrent
/// edit the same way the client's does.
///
/// A SINGLE-REGION diff describes "wrap this phrase in a tag" as "delete the
/// phrase, insert the tagged phrase". Two writers doing that over OVERLAPPING
/// phrases each delete what the other re-inserts, so the shared words land
/// twice and the rest is dropped. That is why the client (document-store.ts,
/// <c>diffText</c>) is a bounded Myers diff over code points, and why this
/// side is too.
/// </summary>
public sealed class YDocConverterTextDiffTests
{
  /// <summary>
  /// The defect in user terms: two people wrap overlapping phrases at the same
  /// moment and every word must still appear exactly once.
  /// </summary>
  [Fact]
  public void TwoPeersWrappingOverlappingPhrasesKeepEveryWordOnce()
  {
    var server = SeededDoc(Paragraph("the quick brown fox"));
    var peer = Cloned(server);

    // The peer wraps "quick brown"; the host pushes a wrap of "brown fox".
    SetText(peer, "the <b>quick brown</b> fox");
    Apply(server, UpdateText("the quick <i>brown fox</i>"));

    Exchange(server, peer);

    var merged = TextOf(server);

    Assert.Equal(1, Occurrences(merged, "quick"));
    Assert.Equal(1, Occurrences(merged, "brown"));
    Assert.Equal(1, Occurrences(merged, "fox"));
    Assert.Equal(merged, TextOf(peer));
  }

  /// <summary>The same phrase wrapped two different ways by two writers.</summary>
  [Fact]
  public void TwoPeersWrappingTheSamePhraseDoNotDuplicateIt()
  {
    var server = SeededDoc(Paragraph("the quick brown fox"));
    var peer = Cloned(server);

    SetText(peer, "the <b>quick brown</b> fox");
    Apply(server, UpdateText("the <i>quick brown</i> fox"));

    Exchange(server, peer);

    var merged = TextOf(server);

    Assert.Equal(1, Occurrences(merged, "quick brown"));
    Assert.Equal(1, Occurrences(merged, "the "));
    Assert.Equal(1, Occurrences(merged, " fox"));
    Assert.Equal(merged, TextOf(peer));
  }

  /// <summary>
  /// A peer typing INSIDE the phrase the host rewrites keeps its characters:
  /// the host's edit must touch only what actually changed.
  /// </summary>
  [Fact]
  public void APeersWordInsideTheRewrittenPhraseIsNotDuplicated()
  {
    var server = SeededDoc(Paragraph("one two three four"));
    var peer = Cloned(server);

    SetText(peer, "one two THREE four");
    Apply(server, UpdateText("one <b>two three</b> four"));

    Exchange(server, peer);

    var merged = TextOf(server);

    Assert.Equal(1, Occurrences(merged, "two"));
    Assert.Equal(1, Occurrences(merged, "four"));
    Assert.Equal(merged, TextOf(peer));
  }

  /// <summary>A plain append is still one insert and loses nothing.</summary>
  [Fact]
  public void AppendingKeepsTheExistingCharacters()
  {
    var doc = SeededDoc(Paragraph("hello"));

    Apply(doc, UpdateText("hello world"));

    Assert.Equal("hello world", TextOf(doc));
  }

  /// <summary>The family emoji is four code points and a ZWJ; it must survive whole.</summary>
  [Fact]
  public void AnEditBesideAFamilyEmojiLeavesItWhole()
  {
    var doc = SeededDoc(Paragraph("hi \U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466 there"));

    Apply(doc, UpdateText("hi \U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466 you"));

    var text = TextOf(doc);

    AssertWellFormed(text);
    Assert.Equal("hi \U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466 you", text);
  }

  /// <summary>A flag is a pair of regional indicators, each its own surrogate pair.</summary>
  [Fact]
  public void SwappingOneFlagForAnotherKeepsBothWellFormed()
  {
    var doc = SeededDoc(Paragraph("from \U0001F1FA\U0001F1F8 today"));

    Apply(doc, UpdateText("from \U0001F1EB\U0001F1F7 today"));

    var text = TextOf(doc);

    AssertWellFormed(text);
    Assert.Equal("from \U0001F1EB\U0001F1F7 today", text);
  }

  /// <summary>A skin-tone modifier follows its base emoji; neither may be split.</summary>
  [Fact]
  public void ChangingASkinToneKeepsTheEmojiWellFormed()
  {
    var doc = SeededDoc(Paragraph("nice \U0001F44D\U0001F3FD!"));

    Apply(doc, UpdateText("nice \U0001F44D\U0001F3FF!"));

    var text = TextOf(doc);

    AssertWellFormed(text);
    Assert.Equal("nice \U0001F44D\U0001F3FF!", text);
  }

  /// <summary>An emoji inserted between two peers' edits stays whole for both.</summary>
  [Fact]
  public void ConcurrentEditsAroundAnEmojiKeepItWellFormed()
  {
    var server = SeededDoc(Paragraph("a \U0001F44D b"));
    var peer = Cloned(server);

    SetText(peer, "a \U0001F44D b!");
    Apply(server, UpdateText("A \U0001F44D b"));

    Exchange(server, peer);

    var merged = TextOf(server);

    AssertWellFormed(merged);
    Assert.Equal(1, Occurrences(merged, "\U0001F44D"));
    Assert.Equal(merged, TextOf(peer));
  }

  /// <summary>Deleting a whole word leaves the rest untouched.</summary>
  [Fact]
  public void DeletingAWordKeepsTheRest()
  {
    var doc = SeededDoc(Paragraph("one two three"));

    Apply(doc, UpdateText("one three"));

    Assert.Equal("one three", TextOf(doc));
  }

  /// <summary>
  /// A whole-string rewrite is past the search cap and falls back to the
  /// single-region answer — it still has to produce the right text.
  /// </summary>
  [Fact]
  public void AWholeStringRewritePastTheCapStillLands()
  {
    var doc = SeededDoc(Paragraph(new string('a', 200)));

    Apply(doc, UpdateText(new string('b', 200)));

    Assert.Equal(new string('b', 200), TextOf(doc));
  }

  /// <summary>
  /// A whole-string emoji rewrite is past the search cap, so the one changed
  /// region decides the boundaries — and it must roll back off a surrogate
  /// pair, or the halves land in separate CRDT items and both peers see
  /// U+FFFD.
  /// </summary>
  [Fact]
  public void AnEmojiRewritePastTheCapStaysWellFormed()
  {
    var doc = SeededDoc(Paragraph(string.Concat(Enumerable.Repeat("\U0001F44D", 40)) + " tail"));
    var after = string.Concat(Enumerable.Repeat("\U0001F44E", 40)) + " tail";

    Apply(doc, UpdateText(after));

    var text = TextOf(doc);

    AssertWellFormed(text);
    Assert.Equal(after, text);
  }

  private static void AssertWellFormed(string text)
  {
    Assert.DoesNotContain('\uFFFD', text);

    for (var index = 0; index < text.Length; index++)
    {
      if (char.IsHighSurrogate(text[index]))
      {
        Assert.True(
            index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]),
            $"lone high surrogate at {index} in \"{text}\"");
        index++;

        continue;
      }

      Assert.False(char.IsLowSurrogate(text[index]), $"lone low surrogate at {index}");
    }
  }

  private static int Occurrences(string haystack, string needle)
  {
    var count = 0;
    var at = haystack.IndexOf(needle, StringComparison.Ordinal);

    while (at >= 0)
    {
      count++;
      at = haystack.IndexOf(needle, at + 1, StringComparison.Ordinal);
    }

    return count;
  }

  private static string Paragraph(string text)
  {
    return $$"""{ "id": "p", "type": "paragraph", "data": { "text": {{Quote(text)}} } }""";
  }

  private static string UpdateText(string text)
  {
    return $$"""{ "op": "update", "id": "p", "data": { "text": {{Quote(text)}} } }""";
  }

  private static string Quote(string text)
  {
    return JsonValue.Create(text).ToJsonString();
  }

  /// <summary>Types into the peer's own YText the way a person does.</summary>
  private static void SetText(YDoc doc, string next)
  {
    var text = Assert.IsType<YText>(DataValue(doc, "p", "text"));
    var before = text.ToString();

    doc.Transact(transaction =>
    {
      foreach (var edit in TextDiff.Diff(before, next).Reverse())
      {
        if (edit.Remove > 0)
        {
          text.Delete(transaction, edit.Index, edit.Remove);
        }

        if (edit.Insert.Length > 0)
        {
          text.Insert(transaction, edit.Index, edit.Insert);
        }
      }
    });

    Assert.Equal(next, text.ToString());
  }

  private static YDoc Cloned(YDoc source)
  {
    var clone = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        clone.ApplyUpdate(source.EncodeStateAsUpdate(clone.EncodeStateVector())).Outcome);

    return clone;
  }

  private static void Exchange(YDoc left, YDoc right)
  {
    var toRight = left.EncodeStateAsUpdate(right.EncodeStateVector());
    var toLeft = right.EncodeStateAsUpdate(left.EncodeStateVector());

    Assert.Equal(ApplyOutcome.Applied, right.ApplyUpdate(toRight).Outcome);
    Assert.Equal(ApplyOutcome.Applied, left.ApplyUpdate(toLeft).Outcome);
  }

  private static string TextOf(YDoc doc)
  {
    return Assert.IsType<YText>(DataValue(doc, "p", "text")).ToString();
  }

  private static YDoc SeededDoc(params string[] blockJson)
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray()));

    return doc;
  }

  private static void Apply(YDoc doc, params string[] opJson)
  {
    YDocConverter.ApplyOps(
        doc,
        CollabEditOps.Parse(
            Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }""")));
  }

  private static object? DataValue(YDoc doc, string id, string key)
  {
    var block = Assert.IsType<YMap>(Entry(doc.GetMap("blocks"), id));

    return Entry(Assert.IsType<YMap>(Entry(block, "data")), key);
  }

  private static object? Entry(YMap map, string key)
  {
    Assert.True(map.TryGet(key, out var value), $"no entry {key}");

    return value;
  }
}
