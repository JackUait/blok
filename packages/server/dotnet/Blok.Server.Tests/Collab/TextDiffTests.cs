using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The diff behind <c>EditText</c>, at the level its boundaries live at.
///
/// It is a port of the client's <c>diffText</c>
/// (src/components/modules/yjs/document-store.ts); these tests pin the three
/// things a port gets wrong: the search cap, the code-point to code-unit
/// mapping, and the order the edits come back in.
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

  /// <summary>An emoji swapped for another is one whole code point in and out.</summary>
  [Fact]
  public void SwappingAnEmojiMovesWholeCodePoints()
  {
    var edits = TextDiff.Diff("a\U0001F44Db", "a\U0001F44Eb");

    Assert.Equal(
        [new TextEdit(1, 2, string.Empty), new TextEdit(3, 0, "\U0001F44E")],
        edits);
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
  /// Past the cap by words too, the single-region answer stands: one delete and
  /// one insert over the changed middle.
  /// </summary>
  [Fact]
  public void PastBothCapsTheSingleRegionAnswerStands()
  {
    var before = string.Join(' ', Enumerable.Range(0, 60).Select(index => $"before{index}"));
    var after = string.Join(' ', Enumerable.Range(0, 60).Select(index => $"after{index}"));

    var edits = TextDiff.Diff(before, after);

    Assert.Single(edits);
    Assert.Equal(after, Apply(before, edits));
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
