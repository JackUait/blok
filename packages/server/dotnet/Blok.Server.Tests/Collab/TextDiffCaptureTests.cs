using System.Globalization;
using System.Reflection;
using System.Text;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// TextDiff and the grapheme data it stands on, captured from C# into
/// fixtures/text-diff/. The Go server must split text and describe a change
/// exactly as C# does, or one document merges differently on the two hosts.
///
/// grapheme-break.json is .NET's own Grapheme_Cluster_Break table (read from
/// the runtime, the source StringInfo uses), so Go segments from the same
/// data. cases.json holds Diff and Atomize answers for hand-picked and
/// generated texts. Strings are written with every non-ASCII UTF-16 unit
/// escaped, so a lone surrogate survives. The Go twin is
/// internal/collab/convert/textdiff_test.go. Set BLOK_WRITE_TEXT_DIFF=1 to
/// rewrite both after an intended change (a .NET upgrade can change the table).
/// </summary>
public sealed class TextDiffCaptureTests
{
  [Fact]
  public void TheGraphemeTableMatchesTheRuntime()
  {
    Check("text-diff/grapheme-break.json", GraphemeTable());
  }

  [Fact]
  public void TheCasesMatchTheDiff()
  {
    Check("text-diff/cases.json", Cases());
  }

  private static void Check(string relative, string built)
  {
    var path = RichTextFixtures.PathOf(relative);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_TEXT_DIFF") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{relative} is missing; run with BLOK_WRITE_TEXT_DIFF=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private static string GraphemeTable()
  {
    var method = typeof(CharUnicodeInfo).GetMethod(
        "GetGraphemeClusterBreakType",
        BindingFlags.NonPublic | BindingFlags.Static,
        [typeof(Rune)]) ?? throw new MissingMethodException("CharUnicodeInfo.GetGraphemeClusterBreakType");
    var written = new StringBuilder();
    written.Append("{\n  \"$comment\": \"Grapheme_Cluster_Break as .NET ").Append(Environment.Version.Major)
        .Append(" reads it (CharUnicodeInfo.GetGraphemeClusterBreakType). Captured by TextDiffCaptureTests; do not edit by hand. Ranges are [first, last, type], code points not listed are Other.\",\n  \"ranges\": [\n");
    string? type = null;
    var first = 0;
    var any = false;

    void Flush(int last)
    {
      if (type is null or "Other")
      {
        return;
      }

      written.Append(any ? ",\n" : "").Append("    [").Append(first).Append(", ").Append(last)
          .Append(", \"").Append(type).Append("\"]");
      any = true;
    }

    for (var code = 0; code <= 0x10FFFF; code++)
    {
      // Surrogates are not scalars; the decoder reads a lone one as U+FFFD (Other).
      var next = code is >= 0xD800 and <= 0xDFFF
          ? "Other"
          : method.Invoke(null, [new Rune(code)])!.ToString();

      if (next != type)
      {
        Flush(code - 1);
        type = next;
        first = code;
      }
    }

    Flush(0x10FFFF);
    written.Append("\n  ]\n}\n");

    return written.ToString();
  }

  private static string Cases()
  {
    var pairs = new List<(string Before, string After, bool Markup)>();
    string P(int code) => char.ConvertFromUtf32(code);
    var thumb = P(0x1F44D);
    var tone = P(0x1F3FD);
    var family = P(0x1F468) + P(0x200D) + P(0x1F469) + P(0x200D) + P(0x1F467);
    var flag = P(0x1F1EB) + P(0x1F1F7);
    var ka = P(0x0915);
    var virama = P(0x094D);
    var ra = P(0x0930);
    var high = ((char)0xD83D).ToString();
    var low = ((char)0xDC4D).ToString();

    void Add(string before, string after, bool markup = true) => pairs.Add((before, after, markup));

    Add("the quick brown fox", "the <b>quick brown</b> fox");
    Add("one two three four", "one TWO three FOUR");
    Add(thumb + "ab", thumb + "axb");
    Add("a" + thumb + "b", "a" + P(0x1F44E) + "b");
    Add("a" + high + "b", "a" + high + "bc");
    Add(new string('a', 64), string.Concat(Enumerable.Repeat("ab", 64)));
    Add(new string('a', 65), string.Concat(Enumerable.Repeat("ab", 65)));
    Add(new string('a', 200), new string('b', 200));
    Add("hello", "<b>hello</b>");
    Add("<b>x</b>", "<b>y</b>");
    Add("<a title=\"a>b\">x</a>", "<a title=\"a>b\">y</a>");
    Add("<a title='a>b'>x</a>", "<a title='a>c'>x</a>");
    Add("<b", "<b>");
    Add("a < b", "a > b");
    Add("<<<", ">>>");
    Add("x <b> &lt;", "x <bQ> &lQt;", markup: false);
    Add("&", "&amp;");
    Add("&amp;", "&");
    Add("&;x", "&;y");
    Add("&#123;a", "&#124;a");
    Add("&" + new string('a', 31) + ";", "&" + new string('a', 31) + ";b");
    Add("&" + new string('a', 30) + ";", "&" + new string('a', 30) + ";b");
    Add("same", "same");
    Add("", "");
    Add("hello", "hello world");
    Add("hello", "");
    Add("", "hello");
    Add("caf" + "e" + P(0x301), "caf" + "e" + P(0x300));
    Add(thumb + tone + "x", thumb + "x");
    Add(family + " hi", family + " ho");
    Add(flag + flag, flag + "x" + flag);
    Add(ka + virama + ra + "a", ka + virama + "a");
    Add(ka + virama + ra + virama + ka, ka + virama + ra + virama + "x");
    Add(ka + P(0x200C) + virama + ra, ka + P(0x200C) + virama + "x");
    Add(P(0x0600) + "<b>bold</b>", P(0x0600) + "<i>bold</i>");
    Add(P(0x0600) + "<b", P(0x0600) + "<c");
    Add("a\r\nb", "a\nb");
    Add("x" + P(0x1100) + P(0x1161) + P(0x11A8) + "y", "x" + P(0x1100) + P(0x1161) + "y");
    Add("a" + low + high + "b", "a" + high + low + "b");
    Add("word" + P(0xFEFF) + "word" + P(0x85) + "word", "w0rd" + P(0xFEFF) + "word" + P(0x85) + "w0rd");
    Add(string.Join(' ', Enumerable.Range(0, 40).Select(i => $"word{i}")),
        string.Join(' ', Enumerable.Range(0, 40).Select(i => i == 5 ? "replacement-of-considerable-length-five" : i == 20 ? "replacement-of-considerable-length-twenty" : $"word{i}")));
    Add(string.Join(' ', Enumerable.Range(0, 60).Select(i => $"before{i}")),
        string.Join(' ', Enumerable.Range(0, 60).Select(i => $"after{i}")));
    Add(string.Concat(Enumerable.Range(0, 120).Select(i => (char)(0x4E00 + i))),
        string.Concat(Enumerable.Range(0, 120).Select(i => (char)(0x4E00 + (i % 7 == 0 ? i + 500 : i)))));

    // Generated: texts from pieces that stress every unit, then random edits.
    var pieces = new[]
    {
      "a", "b", "c", " ", "  ", "\t", "\n", "\r", "\r\n", "<b>", "</b>", "<a href=\"x>y\">", "</a>", "<", ">", "&amp;", "&lt;", "&#39;",
      "&", ";", "'", "\"", "word", "Word", "é", "e" + P(0x301), P(0x301), thumb, thumb + tone, tone, family, P(0x200D), flag,
      P(0x1F1EB), ka, virama, ra, ka + virama + ra, P(0x200C), P(0x093F), P(0x0600), P(0x1100), P(0x1161), P(0x11A8), P(0xAC00),
      P(0xAC01), high, low, P(0xFEFF), P(0x85), P(0xA0), P(0x2028), P(0x3000), P(0x4E2D), P(0x1F600), P(0x2764) + P(0xFE0F),
      P(0x0E33), P(0x1F3F4) + P(0xE0067) + P(0xE0062) + P(0xE007F), "1", "2",
    };
    var random = new SplitMix(20261031);

    string Text(int count)
    {
      var text = new StringBuilder();

      for (var i = 0; i < count; i++)
      {
        text.Append(pieces[random.Next(pieces.Length)]);
      }

      return text.ToString();
    }

    string Mutate(string text, int edits)
    {
      for (var i = 0; i < edits; i++)
      {
        var at = text.Length == 0 ? 0 : random.Next(text.Length + 1);

        switch (random.Next(3))
        {
          case 0:
            text = text.Insert(at, Text(1 + random.Next(3)));
            break;
          case 1:
            text = text.Remove(at, Math.Min(text.Length - at, 1 + random.Next(4)));
            break;
          default:
            text = text.Remove(at, Math.Min(text.Length - at, 1 + random.Next(3))).Insert(at, Text(1));
            break;
        }
      }

      return text;
    }

    for (var i = 0; i < 340; i++)
    {
      var before = Text(random.Next(i < 300 ? 30 : 400));
      Add(before, Mutate(before, 1 + random.Next(i < 300 ? 4 : 80)), markup: random.Next(4) != 0);
    }

    var written = new StringBuilder();
    written.Append("{\n  \"$comment\": \"Captured from C# by TextDiffCaptureTests. Do not edit by hand. Edits are [index, remove, insert] in UTF-16 units.\",\n  \"cases\": [\n");

    for (var i = 0; i < pairs.Count; i++)
    {
      var (before, after, markup) = pairs[i];
      var edits = TextDiff.Diff(before, after, markup);
      written.Append("    {\"before\": ").Append(Quote(before))
          .Append(", \"after\": ").Append(Quote(after))
          .Append(", \"markup\": ").Append(markup ? "true" : "false")
          .Append(", \"atoms\": [").Append(string.Join(", ", TextDiff.Atomize(before, markup).Select(Quote))).Append(']')
          .Append(", \"elements\": [").Append(string.Join(", ", Elements(before))).Append(']')
          .Append(", \"edits\": [")
          .Append(string.Join(", ", edits.Select(edit => $"[{edit.Index}, {edit.Remove}, {Quote(edit.Insert)}]")))
          .Append("]}").Append(i + 1 < pairs.Count ? ",\n" : "\n");
    }

    written.Append("  ]\n}\n");

    return written.ToString();
  }

  /// <summary>Where StringInfo starts each text element, before TextDiff's GB9c join.</summary>
  private static IEnumerable<int> Elements(string text)
  {
    var elements = StringInfo.GetTextElementEnumerator(text);

    while (elements.MoveNext())
    {
      yield return elements.ElementIndex;
    }
  }

  /// <summary>A JSON string with every unit outside printable ASCII escaped, lone surrogates included.</summary>
  private static string Quote(string text)
  {
    var quoted = new StringBuilder("\"");

    foreach (var unit in text)
    {
      if (unit is '"' or '\\')
      {
        quoted.Append('\\').Append(unit);
      }
      else if (unit is >= ' ' and <= '~')
      {
        quoted.Append(unit);
      }
      else
      {
        quoted.Append("\\u").Append(((int)unit).ToString("x4", CultureInfo.InvariantCulture));
      }
    }

    return quoted.Append('"').ToString();
  }

  /// <summary>A fixed generator, so the cases do not move with System.Random.</summary>
  private sealed class SplitMix(ulong seed)
  {
    private ulong state = seed;

    internal int Next(int bound)
    {
      state += 0x9E3779B97F4A7C15;
      var mixed = state;
      mixed = (mixed ^ (mixed >> 30)) * 0xBF58476D1CE4E5B9;
      mixed = (mixed ^ (mixed >> 27)) * 0x94D049BB133111EB;
      mixed ^= mixed >> 31;

      return (int)(mixed % (ulong)bound);
    }
  }
}
