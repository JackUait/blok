using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The diff behind <c>EditText</c>, at the level its boundaries live at.
///
/// It is a port of the client's <c>diffText</c>
/// (src/components/modules/yjs/text-diff.ts); these tests pin the things a port
/// gets wrong: the UNITS it may cut between, the search cap and the tier past
/// it, the code-point to code-unit mapping, and the order the edits come back
/// in.
/// </summary>
public sealed class TextDiffTests
{
  /// <summary>
  /// The whole point: wrapping a phrase is two INSERTS, not a delete of the
  /// phrase and an insert of the tagged phrase. Only the first describes the
  /// change in a way a peer's concurrent edit can merge with.
  /// </summary>
  [Fact]
  public void WrappingAPhraseIsTwoInsertsAndTouchesNothingElse()
  {
    var edits = TextDiff.Diff("the quick brown fox", "the <b>quick brown</b> fox");

    Assert.Equal(
        [new TextEdit(4, 0, "<b>"), new TextEdit(15, 0, "</b>")],
        edits);
  }

  /// <summary>Edits come back ascending, so applying them back to front is safe.</summary>
  [Fact]
  public void EditsComeBackInAscendingIndexOrder()
  {
    var edits = TextDiff.Diff("one two three four", "one TWO three FOUR");

    Assert.Equal(edits.OrderBy(edit => edit.Index).ToArray(), edits.ToArray());
    Assert.True(edits.Count > 1, "two separate changes should be two edits");
    Assert.Equal("one TWO three FOUR", Apply("one two three four", edits));
  }

  /// <summary>
  /// Indices are UTF-16 code units, because that is how <c>YText</c> counts.
  /// The search runs over code POINTS, so an emoji before the change shifts
  /// every later index by two, not one.
  /// </summary>
  [Fact]
  public void AnEditAfterAnEmojiIsIndexedInCodeUnits()
  {
    var edits = TextDiff.Diff("\U0001F44Dab", "\U0001F44Daxb");

    Assert.Equal([new TextEdit(3, 0, "x")], edits);
  }

  /// <summary>
  /// An emoji swapped for another is one whole code point out and one in, as
  /// ONE replacement: the delete and the insert against its end are fused, so
  /// the new character is anchored where the old one was rather than to the
  /// right of its tombstone.
  /// </summary>
  [Fact]
  public void SwappingAnEmojiMovesWholeCodePoints()
  {
    var edits = TextDiff.Diff("a\U0001F44Db", "a\U0001F44Eb");

    Assert.Equal([new TextEdit(1, 2, "\U0001F44E")], edits);
    Assert.Equal("a\U0001F44Eb", Apply("a\U0001F44Db", edits));
  }

  /// <summary>A lone surrogate in the stored text is carried, never rewritten.</summary>
  [Fact]
  public void ALoneSurrogateIsCarriedThrough()
  {
    var before = "a\uD83Db";
    var edits = TextDiff.Diff(before, "a\uD83Dbc");

    Assert.Equal("a\uD83Dbc", Apply(before, edits));
  }

  /// <summary>
  /// An edit distance OF the cap is still searched: 64 single-character
  /// insertions come back as 64 edits, not as one rewritten region.
  /// </summary>
  [Fact]
  public void AnEditDistanceOfExactlyTheCapIsStillMinimal()
  {
    var before = new string('a', TextDiff.MaxDiffDistance);
    var after = string.Concat(Enumerable.Repeat("ab", TextDiff.MaxDiffDistance));

    var edits = TextDiff.Diff(before, after);

    Assert.Equal(TextDiff.MaxDiffDistance, edits.Count);
    Assert.Equal(after, Apply(before, edits));
  }

  /// <summary>
  /// Past the cap by characters the same search runs over WORDS, so a bulk
  /// rewrite costs the words it touched and the untouched ones keep their CRDT
  /// identity.
  /// </summary>
  [Fact]
  public void PastTheCharacterCapTheSearchRunsOverWords()
  {
    var words = Enumerable.Range(0, 40).Select(index => $"word{index}").ToArray();
    var before = string.Join(' ', words);
    var rewritten = words.ToArray();

    rewritten[5] = "replacement-of-considerable-length-five";
    rewritten[20] = "replacement-of-considerable-length-twenty";

    var after = string.Join(' ', rewritten);

    Assert.True(
        TextDiff.Diff(before, after).Count > 1,
        "two separate word changes should not collapse into one rewritten region");
    Assert.Equal(after, Apply(before, TextDiff.Diff(before, after)));
    Assert.All(
        TextDiff.Diff(before, after),
        edit => Assert.DoesNotContain("word0", edit.Insert, StringComparison.Ordinal));
  }

  /// <summary>
  /// Past the cap, the anchored split answers each gap on its own, so a rewrite
  /// of sixty words is sixty narrow replacements rather than one block-wide
  /// region. The one region is what moved a peer's concurrent keystroke to the
  /// start of the block: it deletes every character that keystroke was anchored
  /// between.
  /// </summary>
  [Fact]
  public void PastTheCapEachGapIsAnsweredOnItsOwn()
  {
    var before = string.Join(' ', Enumerable.Range(0, 60).Select(index => $"before{index}"));
    var after = string.Join(' ', Enumerable.Range(0, 60).Select(index => $"after{index}"));

    var edits = TextDiff.Diff(before, after);

    Assert.Equal(new TextEdit(0, 7, "after0"), edits[0]);
    Assert.True(edits.Count > 50, $"a per-gap answer, not one region: {edits.Count} edits");
    Assert.Equal(after, Apply(before, edits));
  }

  /// <summary>
  /// With NO anchor in common — a paste sharing nothing with what it replaces —
  /// the single gap spans everything and the answer is the one region, exactly
  /// what it was before the anchor tier existed.
  /// </summary>
  [Fact]
  public void WithNoAnchorsTheSingleRegionAnswerStillStands()
  {
    var edits = TextDiff.Diff(new string('a', 200), new string('b', 200));

    Assert.Equal([new TextEdit(0, 200, new string('b', 200))], edits);
  }

  /// <summary>
  /// A COMPLETE TAG is one unit, so re-tagging a phrase never reuses a letter
  /// of the phrase as part of the tag. Over code points Myers is free to spend
  /// the word's own `b` on `&lt;b&gt;` — and the peer fixing that letter is
  /// then editing the inside of the other peer's tag.
  /// </summary>
  [Fact]
  public void ATagIsOneUnitAndNeverSharesACharacterWithContent()
  {
    Assert.Equal(
        [new TextEdit(0, 0, "<b>"), new TextEdit(5, 0, "</b>")],
        TextDiff.Diff("hello", "<b>hello</b>"));
    Assert.Equal([new TextEdit(3, 1, "y")], TextDiff.Diff("<b>x</b>", "<b>y</b>"));
  }

  /// <summary>
  /// An attribute value may carry a `&gt;` — serializing an element does not
  /// escape one — so the scanner reads through quotes and the tag stays ONE
  /// unit.
  /// </summary>
  [Fact]
  public void AQuotedAngleBracketDoesNotEndATag()
  {
    Assert.Equal(
        [new TextEdit(15, 1, "y")],
        TextDiff.Diff("<a title=\"a>b\">x</a>", "<a title=\"a>b\">y</a>"));
  }

  /// <summary>
  /// MALFORMED markup is text the user typed, and stays one atom per code
  /// point: an unclosed tag, a bare `&lt;`, and a second `&lt;` before any
  /// `&gt;`.
  /// </summary>
  [Fact]
  public void MalformedMarkupStaysOrdinaryText()
  {
    Assert.Equal([new TextEdit(0, 2, "<b>")], TextDiff.Diff("<b", "<b>"));
    Assert.Equal([new TextEdit(2, 1, ">")], TextDiff.Diff("a < b", "a > b"));
    Assert.Equal([new TextEdit(0, 3, ">>>")], TextDiff.Diff("<<<", ">>>"));
  }

  /// <summary>An entity reference is one unit, so `&amp;` never half-becomes one.</summary>
  [Fact]
  public void AnEntityIsOneUnit()
  {
    Assert.Equal([new TextEdit(0, 1, "&amp;")], TextDiff.Diff("&", "&amp;"));
    Assert.Equal([new TextEdit(0, 5, "&")], TextDiff.Diff("&amp;", "&"));
  }

  /// <summary>
  /// A paragraph pasted twice over itself: past the character cap, the common
  /// prefix and the common suffix must not be allowed to overlap, or the two
  /// slices cross and the duplicate is never deleted.
  /// </summary>
  [Fact]
  public void DeletingADuplicatedHalfPastTheCapStillDeletesIt()
  {
    var once = string.Concat(Enumerable.Repeat("lorem ipsum dolor sit amet ", 4));
    var edits = TextDiff.Diff(once + once, once);

    Assert.NotEmpty(edits);
    Assert.Equal(once, Apply(once + once, edits));
  }

  /// <summary>
  /// Words are split on JavaScript's whitespace set, not .NET's. A zero-width
  /// no-break space separates words for the client, so an edit past the cap has
  /// to stay on its own side of one instead of rewriting the word before it.
  /// </summary>
  [Fact]
  public void AZeroWidthNoBreakSpaceSeparatesWordsAsItDoesOnTheClient()
  {
    var filler = string.Concat(Enumerable.Repeat("filler word here ", 8));
    var before = filler + "keepthisword\ufeffchangethisword";
    var after = filler.Replace("filler", "FILLER", StringComparison.Ordinal) +
        "keepthisword\ufeffCHANGED";

    var edits = TextDiff.Diff(before, after);

    Assert.All(
        edits,
        edit => Assert.DoesNotContain("keepthisword", edit.Insert, StringComparison.Ordinal));
    Assert.Equal(after, Apply(before, edits));
  }

  /// <summary>A whole-string rewrite is past the cap and still lands exactly.</summary>
  [Fact]
  public void AWholeStringRewriteStillProducesTheRightText()
  {
    var before = new string('a', 200);
    var after = new string('b', 200);

    Assert.Equal(after, Apply(before, TextDiff.Diff(before, after)));
  }

  /// <summary>Equal texts are no edits at all.</summary>
  [Fact]
  public void EqualTextsDiffToNothing()
  {
    Assert.Empty(TextDiff.Diff("same", "same"));
    Assert.Empty(TextDiff.Diff(string.Empty, string.Empty));
  }

  /// <summary>Typing at the end is one insert, not one per character.</summary>
  [Fact]
  public void TypingAWordIsASingleInsert()
  {
    Assert.Equal([new TextEdit(5, 0, " world")], TextDiff.Diff("hello", "hello world"));
  }

  /// <summary>Clearing the text is one delete.</summary>
  [Fact]
  public void ClearingTheTextIsOneDelete()
  {
    Assert.Equal([new TextEdit(0, 5, string.Empty)], TextDiff.Diff("hello", string.Empty));
  }

  /// <summary>Filling empty text is one insert.</summary>
  [Fact]
  public void FillingEmptyTextIsOneInsert()
  {
    Assert.Equal([new TextEdit(0, 0, "hello")], TextDiff.Diff(string.Empty, "hello"));
  }

  /// <summary>Applies edits the way EditText does: back to front.</summary>
  private static string Apply(string before, IReadOnlyList<TextEdit> edits)
  {
    var text = before;

    for (var index = edits.Count - 1; index >= 0; index--)
    {
      var edit = edits[index];

      text = string.Concat(
          text.AsSpan(0, edit.Index),
          edit.Insert,
          text.AsSpan(edit.Index + edit.Remove));
    }

    return text;
  }
}
