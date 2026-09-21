using System.Globalization;
using System.Text.RegularExpressions;

namespace Blok.Server.Collab;

/// <summary>One edit turning the stored text into the saved text.</summary>
/// <param name="Index">Offset into the stored text, in UTF-16 code units.</param>
/// <param name="Remove">How many code units to drop at <paramref name="Index"/>.</param>
/// <param name="Insert">What to put there instead.</param>
internal readonly record struct TextEdit(int Index, int Remove, string Insert);

/// <summary>
/// The smallest set of edits turning one string into another.
///
/// Minimal, not single-region, because these edits merge with a peer's. A
/// one-region diff describes "wrap this phrase in a tag" as "delete the phrase,
/// insert the tagged phrase" — so two peers wrapping OVERLAPPING phrases each
/// delete what the other re-inserts, and the shared words land twice while the
/// rest is dropped.
///
/// Three steps, each narrower than the next is wide:
///
/// 1. Myers over ATOMS — a whole tag, a whole entity, otherwise one
///    USER-VISIBLE character (see <see cref="Atomize"/>).
/// 2. Once the atom distance passes the cap, SPLIT both texts at runs of atoms
///    that occur exactly once on both sides — they can only be each other — and
///    answer each gap between two anchors on its own.
/// 3. Per gap, <see cref="CoarseOps"/>: the words of that gap, then the gap's
///    single region. With no anchors at all the single gap spans everything and
///    the answer is exactly what it was before the anchor tier existed.
///
/// This is a port of the client's <c>diffText</c>
/// (src/components/modules/yjs/text-diff.ts). THE TWO MUST MOVE TOGETHER: a
/// host's /edit push and a browser's save have to describe the same change the
/// same way, or the same document is described differently on the two sides and
/// merges differently. Change one, change the other — the cap, the tiers, the
/// units, the anchor hash and the fusing all have to stay equal.
/// </summary>
internal static partial class TextDiff
{
  /// <summary>
  /// How far each bounded search looks before giving up. Myers costs O(N·D) in
  /// the edit distance: typing is D of about 1 and wrapping a range in tags is
  /// D of about 2 — a complete tag is ONE unit here — so the cap never bites a
  /// real edit, while a whole-string replacement — a paste over a selection, a
  /// tool normalising its own markup — has a D the size of the text and costs
  /// seconds at a few thousand characters. Past the cap both texts are split at
  /// anchors and every gap is answered on its own (<see cref="Diff"/>).
  ///
  /// Same value as MAX_DIFF_DISTANCE in text-diff.ts. Widen the UNITS, not the
  /// cap.
  /// </summary>
  internal const int MaxDiffDistance = 64;

  /// <summary>
  /// How many atoms an anchor is measured over. A single atom is almost never
  /// unique — every <c>e</c> in the paragraph is the same atom — so anchoring
  /// on one finds nothing in ordinary prose. Three consecutive atoms is the
  /// shortest run that is unique in everyday text.
  /// </summary>
  private const int AnchorAtoms = 3;

  /// <summary>
  /// Longest an entity reference may be before the scanner gives up and treats
  /// the <c>&amp;</c> as ordinary text.
  /// <c>&amp;CounterClockwiseContourIntegral;</c> is the longest named
  /// reference HTML defines, at 31 characters plus the ampersand.
  /// </summary>
  private const int MaxEntityLength = 32;

  private const uint FnvOffsetBasis = 0x811c9dc5;
  private const uint FnvPrime = 0x01000193;

  /// <summary>
  /// JavaScript's <c>\s</c>, spelled out. .NET's differs at both ends — it
  /// counts U+0085 and does not count U+FEFF — and the two sides have to split
  /// words at exactly the same places.
  ///
  /// Escaped, not literal: raw U+2028/U+2029 in the source are end-of-line
  /// markers to <c>dotnet format</c>. This is a character-CLASS body, so
  /// <c>\t\n\v\f\r</c> stay two characters each — regex escapes, not the
  /// control characters.
  /// </summary>
  private const string JsWhitespace =
      "\\t\\n\\v\\f\\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF";

  /// <summary>
  /// The edits turning <paramref name="before"/> into <paramref name="after"/>,
  /// in ascending order of index, every index counting from
  /// <paramref name="before"/>. Apply them BACK TO FRONT, and each one INSERT
  /// FIRST (see <c>YDocConverter.EditText</c>).
  /// </summary>
  internal static IReadOnlyList<TextEdit> Diff(string before, string after)
  {
    var beforeAtoms = Atomize(before);
    var afterAtoms = Atomize(after);
    var atomOps = MyersOps(beforeAtoms, afterAtoms);

    if (atomOps is not null)
    {
      return atomOps;
    }

    var beforeUnits = UnitOffsets(beforeAtoms);
    var afterUnits = UnitOffsets(afterAtoms);
    var found = Anchors(before, after, beforeUnits, afterUnits);

    if (found.Count == 0)
    {
      return CoarseOps(before, after);
    }

    // Anchors are SPLIT POINTS, not consumed matches: every atom stays inside
    // some gap, and each gap's ops turn that gap of `before` into that gap of
    // `after` on their own. The result is then exactly `after` whatever the
    // anchors were — a bad pairing can only cost a worse answer, never a wrong
    // one.
    var ops = new List<TextEdit>();
    var beforeFrom = 0;
    var afterFrom = 0;

    foreach (var (beforeIndex, afterIndex) in
        found.Append((beforeAtoms.Length, afterAtoms.Length)))
    {
      var beforeText = before[beforeUnits[beforeFrom]..beforeUnits[beforeIndex]];
      var afterText = after[afterUnits[afterFrom]..afterUnits[afterIndex]];

      if (!string.Equals(beforeText, afterText, StringComparison.Ordinal))
      {
        var gapOps = MyersOps(beforeAtoms[beforeFrom..beforeIndex], afterAtoms[afterFrom..afterIndex]) ??
            CoarseOps(beforeText, afterText);
        var shift = beforeUnits[beforeFrom];

        ops.AddRange(gapOps.Select(op => op with { Index = op.Index + shift }));
      }

      beforeFrom = beforeIndex;
      afterFrom = afterIndex;
    }

    return ops;
  }

  /// <summary>
  /// The coarse answer for one span: Myers over its WORDS, and the single
  /// region when even that is further than the cap allows.
  ///
  /// What the single-region answer costs is not characters — the length stays
  /// exact — it is POSITION: the one region deletes every character a
  /// concurrent keystroke sat between, so the engine has no surviving
  /// neighbour to anchor it to and it surfaces at the edge of the span.
  /// </summary>
  private static TextEdit[] CoarseOps(string before, string after)
  {
    // Code units, and surrogate-safe: lib0's own ends roll back off a surrogate
    // boundary, so the region never starts or ends inside a character.
    var (index, remove, insert) = SingleRegion(before, after);

    if (remove == 0 && insert.Length == 0)
    {
      return [];
    }

    var wordOps = MyersOps(Tokenize(before.Substring(index, remove)), Tokenize(insert));

    return wordOps is null
        ? [new TextEdit(index, remove, insert)]
        : wordOps.Select(op => op with { Index = op.Index + index }).ToArray();
  }

  /// <summary>
  /// The three Unicode <c>Indic_Conjunct_Break</c> sets GB9c is written in, as
  /// pairs of inclusive code-point bounds, in order: the linkers (viramas),
  /// the consonants they join, and the extenders that BREAK a conjunct rather
  /// than keeping it (ZWNJ and the spacing marks).
  ///
  /// .NET's own grapheme tables do not implement GB9c, so without these the
  /// host splits <c>क्र</c> where the browser keeps it whole and the two sides
  /// answer different edits for the same keystroke. They were derived by
  /// asking the client's own <c>Intl.Segmenter</c> which code points behave
  /// this way — the same way text-diff.ts derives its tables — because the
  /// property is not exposed by any .NET API.
  ///
  /// TARGET: Unicode 17.0 (ICU 78, Node 26). The server cannot know which ICU
  /// a given browser carries, and 17.0 only ADDED to all three sets — it took
  /// nothing away — so the newest tables are a superset of every older one.
  /// Committing the newest means the host never SPLITS a conjunct an older
  /// browser keeps whole, which is the failure the tables exist to prevent;
  /// the reverse, joining one an older browser splits, only widens an edit.
  ///
  /// LOCKSTEP: an ICU upgrade that ADDS to these sets moves a newer client's
  /// character boundaries past this file, and it must follow in the same
  /// change, or Indic text merges differently on the two sides. Pinned by
  /// test/unit/server-conformance/server-concurrent-loss-wave2.test.ts, which
  /// re-derives all three from the live segmenter: it demands this file cover
  /// everything that engine derives, and exact equality once the engine is on
  /// the target version.
  /// </summary>
  private static readonly int[] ConjunctLinkers =
  [
      0x094D, 0x094D, 0x09CD, 0x09CD, 0x0ACD, 0x0ACD, 0x0B4D, 0x0B4D,
      0x0C4D, 0x0C4D, 0x0D4D, 0x0D4D, 0x1039, 0x1039, 0x17D2, 0x17D2,
      0x1A60, 0x1A60, 0x1B44, 0x1B44, 0x1BAB, 0x1BAB, 0xA9C0, 0xA9C0,
      0xAAF6, 0xAAF6, 0x10A3F, 0x10A3F, 0x11133, 0x11133, 0x113D0, 0x113D0,
      0x1193E, 0x1193E, 0x11A47, 0x11A47, 0x11A99, 0x11A99, 0x11F42, 0x11F42
  ];

  /// <summary>InCB=Consonant, the characters a linker joins. See <see cref="ConjunctLinkers"/>.</summary>
  private static readonly int[] ConjunctConsonants =
  [
      0x0915, 0x0939, 0x0958, 0x095F, 0x0978, 0x097F, 0x0995, 0x09A8,
      0x09AA, 0x09B0, 0x09B2, 0x09B2, 0x09B6, 0x09B9, 0x09DC, 0x09DD,
      0x09DF, 0x09DF, 0x09F0, 0x09F1, 0x0A95, 0x0AA8, 0x0AAA, 0x0AB0,
      0x0AB2, 0x0AB3, 0x0AB5, 0x0AB9, 0x0AF9, 0x0AF9, 0x0B15, 0x0B28,
      0x0B2A, 0x0B30, 0x0B32, 0x0B33, 0x0B35, 0x0B39, 0x0B5C, 0x0B5D,
      0x0B5F, 0x0B5F, 0x0B71, 0x0B71, 0x0C15, 0x0C28, 0x0C2A, 0x0C39,
      0x0C58, 0x0C5A, 0x0D15, 0x0D3A, 0x1000, 0x102A, 0x103F, 0x103F,
      0x1050, 0x1055, 0x105A, 0x105D, 0x1061, 0x1061, 0x1065, 0x1066,
      0x106E, 0x1070, 0x1075, 0x1081, 0x108E, 0x108E, 0x1780, 0x17B3,
      0x1A20, 0x1A54, 0x1B0B, 0x1B0C, 0x1B13, 0x1B33, 0x1B45, 0x1B4C,
      0x1B83, 0x1BA0, 0x1BAE, 0x1BAF, 0x1BBB, 0x1BBD, 0xA989, 0xA98B,
      0xA98F, 0xA9B2, 0xA9E0, 0xA9E4, 0xA9E7, 0xA9EF, 0xA9FA, 0xA9FE,
      0xAA60, 0xAA6F, 0xAA71, 0xAA73, 0xAA7A, 0xAA7A, 0xAA7E, 0xAA7F,
      0xAAE0, 0xAAEA, 0xABC0, 0xABDA, 0x10A00, 0x10A00, 0x10A10, 0x10A13,
      0x10A15, 0x10A17, 0x10A19, 0x10A35, 0x11103, 0x11126, 0x11144, 0x11144,
      0x11147, 0x11147, 0x11380, 0x11389, 0x1138B, 0x1138B, 0x1138E, 0x1138E,
      0x11390, 0x113B5, 0x11900, 0x11906, 0x11909, 0x11909, 0x1190C, 0x11913,
      0x11915, 0x11916, 0x11918, 0x1192F, 0x11A00, 0x11A00, 0x11A0B, 0x11A32,
      0x11A50, 0x11A50, 0x11A5C, 0x11A83, 0x11F04, 0x11F10, 0x11F12, 0x11F33
  ];

  /// <summary>
  /// Extenders that are NOT InCB=Extend, so one of them between a consonant
  /// and its linker ends the conjunct. See <see cref="ConjunctLinkers"/>.
  /// </summary>
  private static readonly int[] ConjunctBreakers =
  [
      0x0903, 0x0903, 0x093B, 0x093B, 0x093E, 0x0940, 0x0949, 0x094C,
      0x094E, 0x094F, 0x0982, 0x0983, 0x09BF, 0x09C0, 0x09C7, 0x09C8,
      0x09CB, 0x09CC, 0x0A03, 0x0A03, 0x0A3E, 0x0A40, 0x0A83, 0x0A83,
      0x0ABE, 0x0AC0, 0x0AC9, 0x0AC9, 0x0ACB, 0x0ACC, 0x0B02, 0x0B03,
      0x0B40, 0x0B40, 0x0B47, 0x0B48, 0x0B4B, 0x0B4C, 0x0BBF, 0x0BBF,
      0x0BC1, 0x0BC2, 0x0BC6, 0x0BC8, 0x0BCA, 0x0BCC, 0x0C01, 0x0C03,
      0x0C41, 0x0C44, 0x0C82, 0x0C83, 0x0CBE, 0x0CBE, 0x0CC1, 0x0CC1,
      0x0CC3, 0x0CC4, 0x0CF3, 0x0CF3, 0x0D02, 0x0D03, 0x0D3F, 0x0D40,
      0x0D46, 0x0D48, 0x0D4A, 0x0D4C, 0x0D82, 0x0D83, 0x0DD0, 0x0DD1,
      0x0DD8, 0x0DDE, 0x0DF2, 0x0DF3, 0x0E33, 0x0E33, 0x0EB3, 0x0EB3,
      0x0F3E, 0x0F3F, 0x0F7F, 0x0F7F, 0x1031, 0x1031, 0x103B, 0x103C,
      0x1056, 0x1057, 0x1084, 0x1084, 0x17B6, 0x17B6, 0x17BE, 0x17C5,
      0x17C7, 0x17C8, 0x1923, 0x1926, 0x1929, 0x192B, 0x1930, 0x1931,
      0x1933, 0x1938, 0x1A19, 0x1A1A, 0x1A55, 0x1A55, 0x1A57, 0x1A57,
      0x1A6D, 0x1A72, 0x1B04, 0x1B04, 0x1B3E, 0x1B41, 0x1B82, 0x1B82,
      0x1BA1, 0x1BA1, 0x1BA6, 0x1BA7, 0x1BE7, 0x1BE7, 0x1BEA, 0x1BEC,
      0x1BEE, 0x1BEE, 0x1C24, 0x1C2B, 0x1C34, 0x1C35, 0x1CE1, 0x1CE1,
      0x1CF7, 0x1CF7, 0x200C, 0x200C, 0xA823, 0xA824, 0xA827, 0xA827,
      0xA880, 0xA881, 0xA8B4, 0xA8C3, 0xA952, 0xA952, 0xA983, 0xA983,
      0xA9B4, 0xA9B5, 0xA9BA, 0xA9BB, 0xA9BE, 0xA9BF, 0xAA2F, 0xAA30,
      0xAA33, 0xAA34, 0xAA4D, 0xAA4D, 0xAAEB, 0xAAEB, 0xAAEE, 0xAAEF,
      0xAAF5, 0xAAF5, 0xABE3, 0xABE4, 0xABE6, 0xABE7, 0xABE9, 0xABEA,
      0xABEC, 0xABEC, 0x11000, 0x11000, 0x11002, 0x11002, 0x11082, 0x11082,
      0x110B0, 0x110B2, 0x110B7, 0x110B8, 0x1112C, 0x1112C, 0x11145, 0x11146,
      0x11182, 0x11182, 0x111B3, 0x111B5, 0x111BF, 0x111BF, 0x111CE, 0x111CE,
      0x1122C, 0x1122E, 0x11232, 0x11233, 0x112E0, 0x112E2, 0x11302, 0x11303,
      0x1133F, 0x1133F, 0x11341, 0x11344, 0x11347, 0x11348, 0x1134B, 0x1134C,
      0x11362, 0x11363, 0x113B9, 0x113BA, 0x113CA, 0x113CA, 0x113CC, 0x113CD,
      0x11435, 0x11437, 0x11440, 0x11441, 0x11445, 0x11445, 0x114B1, 0x114B2,
      0x114B9, 0x114B9, 0x114BB, 0x114BC, 0x114BE, 0x114BE, 0x114C1, 0x114C1,
      0x115B0, 0x115B1, 0x115B8, 0x115BB, 0x115BE, 0x115BE, 0x11630, 0x11632,
      0x1163B, 0x1163C, 0x1163E, 0x1163E, 0x116AC, 0x116AC, 0x116AE, 0x116AF,
      0x1171E, 0x1171E, 0x11726, 0x11726, 0x1182C, 0x1182E, 0x11838, 0x11838,
      0x11931, 0x11935, 0x11937, 0x11938, 0x11940, 0x11940, 0x11942, 0x11942,
      0x119D1, 0x119D3, 0x119DC, 0x119DF, 0x119E4, 0x119E4, 0x11A39, 0x11A39,
      0x11A57, 0x11A58, 0x11A97, 0x11A97, 0x11B61, 0x11B61, 0x11B65, 0x11B65,
      0x11B67, 0x11B67, 0x11C2F, 0x11C2F, 0x11C3E, 0x11C3E, 0x11CA9, 0x11CA9,
      0x11CB1, 0x11CB1, 0x11CB4, 0x11CB4, 0x11D8A, 0x11D8E, 0x11D93, 0x11D94,
      0x11D96, 0x11D96, 0x11EF5, 0x11EF6, 0x11F03, 0x11F03, 0x11F34, 0x11F35,
      0x11F3E, 0x11F3F, 0x1612A, 0x1612C, 0x16F51, 0x16F87
  ];

  /// <summary>
  /// The units the diff may put an edit boundary between: a COMPLETE tag, a
  /// complete entity reference, otherwise one USER-VISIBLE character.
  ///
  /// This is what stops the merge treating markup as spellable text. A block's
  /// <c>text</c> is the tool's innerHTML — markup and content in one string
  /// with no boundary — and Myers is minimal, so over code points it happily
  /// expresses "bold this word" as "insert <c>&lt;</c>, REUSE the word's own
  /// <c>b</c>, insert <c>&gt;</c>…". The tag then owns a letter of the word,
  /// and the peer fixing that letter is editing the inside of the tag. Whole
  /// tags cannot be half-edited and never share a character with content.
  ///
  /// Code points, never code units: an edit boundary inside a surrogate pair
  /// puts the halves in separate CRDT items and the engine replaces both with
  /// U+FFFD.
  ///
  /// And whole CHARACTERS, never bare code points: a letter plus its accent, a
  /// thumb plus its skin tone, a ZWJ family, a two-indicator flag are each
  /// several code points, and a boundary inside one hands a peer's edit the
  /// rest of the cluster. The client reads the UAX #29 rules through
  /// <c>Intl.Segmenter</c>; <see cref="StringInfo"/> reads the same ones, so
  /// the two sides split a character alike. Its range tables are a V8
  /// workaround, not part of the contract, and are deliberately NOT ported.
  /// </summary>
  internal static string[] Atomize(string text)
  {
    var interiors = ClusterInteriors(text);

    // Nothing structured to protect and no character longer than a code point:
    // split code points in one pass.
    if (interiors.Count == 0 && !text.Contains('<') && !text.Contains('&'))
    {
      return CodePoints(text);
    }

    var atoms = new List<string>(text.Length);
    var index = 0;

    while (index < text.Length)
    {
      var structured = StructuredEnd(text, index, text[index]);

      // A tag or an entity is never part of a character, so it is never
      // extended: a `>` and an accent typed after it are two atoms, and the
      // accent stays editable.
      if (structured > index)
      {
        atoms.Add(text[index..structured]);
        index = structured;

        continue;
      }

      var size = char.IsHighSurrogate(text[index]) &&
          index + 1 < text.Length &&
          char.IsLowSurrogate(text[index + 1])
        ? 2
        : 1;
      var end = index + size;

      // Stop at a tag or an entity even when the character wants to swallow
      // it. The Prepend characters — the Arabic number signs, U+0D4E, the
      // Brahmic ones — cluster with whatever FOLLOWS, and `؀<b>bold` put the
      // `<` inside the previous atom, so retagging landed an edit boundary
      // between `<` and `b`. That is the boundary-inside-markup this file
      // exists to stop. A bare `<` that starts no tag still clusters.
      while (interiors.Contains(end) && StructuredEnd(text, end, text[end]) == end)
      {
        end++;
      }

      atoms.Add(text[index..end]);
      index = end;
    }

    return atoms.ToArray();
  }

  /// <summary>
  /// Code-unit offsets that fall INSIDE a user-visible character, so no atom
  /// may begin there. Every offset of a character past its first is in the
  /// set, so the scanner can walk to that character's end one unit at a time.
  ///
  /// <see cref="StringInfo"/> answers every UAX #29 rule but GB9c, so the
  /// conjunct join is applied on top of it — see <see cref="JoinsConjunct"/>.
  /// </summary>
  private static HashSet<int> ClusterInteriors(string text)
  {
    var starts = new List<int>();
    var characters = StringInfo.GetTextElementEnumerator(text);

    while (characters.MoveNext())
    {
      starts.Add(characters.ElementIndex);
    }

    var inside = new HashSet<int>();
    var clusterStart = 0;

    for (var index = 0; index < starts.Count; index++)
    {
      var start = starts[index];
      var end = index + 1 < starts.Count ? starts[index + 1] : text.Length;

      // The boundary disappears, and the joined character keeps its original
      // start so a second conjunct chains onto the same one.
      if (index > 0 && JoinsConjunct(text, clusterStart, start))
      {
        inside.Add(start);
      }
      else
      {
        clusterStart = start;
      }

      for (var at = start + 1; at < end; at++)
      {
        inside.Add(at);
      }
    }

    return inside;
  }

  /// <summary>
  /// UAX #29 GB9c: a consonant, a linker and the consonant after it are ONE
  /// character — <c>Consonant (Extend | Linker)* Linker (Extend | Linker)*
  /// × Consonant</c>. Walks back from the boundary over the previous
  /// character, which <see cref="StringInfo"/> has already closed, so every
  /// code point in it past the first is an extender.
  /// </summary>
  private static bool JoinsConjunct(string text, int clusterStart, int boundary)
  {
    if (!InRanges(ConjunctConsonants, CodePointAt(text, boundary)))
    {
      return false;
    }

    var at = boundary;
    var linked = false;

    while (at > clusterStart)
    {
      var start = at - (at - 1 > clusterStart && char.IsLowSurrogate(text[at - 1]) &&
          char.IsHighSurrogate(text[at - 2]) ? 2 : 1);
      var code = CodePointAt(text, start);

      if (InRanges(ConjunctLinkers, code))
      {
        linked = true;
        at = start;

        continue;
      }

      // Anything else inside the character is an extender, and it keeps the
      // conjunct only when it is an InCB=Extend one.
      if (start > clusterStart && !InRanges(ConjunctBreakers, code))
      {
        at = start;

        continue;
      }

      return linked && InRanges(ConjunctConsonants, code);
    }

    return false;
  }

  /// <summary>Whether <paramref name="ranges"/> holds <paramref name="code"/>.</summary>
  private static bool InRanges(int[] ranges, int code)
  {
    for (var at = 0; at < ranges.Length; at += 2)
    {
      if (code <= ranges[at + 1])
      {
        return code >= ranges[at];
      }
    }

    return false;
  }

  /// <summary>The whole code point at <paramref name="index"/>.</summary>
  private static int CodePointAt(string text, int index)
  {
    return char.IsHighSurrogate(text[index]) &&
        index + 1 < text.Length &&
        char.IsLowSurrogate(text[index + 1])
      ? char.ConvertToUtf32(text[index], text[index + 1])
      : text[index];
  }

  /// <summary>
  /// Where the structure starting at <paramref name="start"/> ends — a tag, an
  /// entity — or <paramref name="start"/> when nothing structured starts there.
  /// </summary>
  private static int StructuredEnd(string text, int start, char code)
  {
    if (code == '<')
    {
      return TagEnd(text, start);
    }

    return code == '&' ? EntityEnd(text, start) : start;
  }

  /// <summary>
  /// Where the tag that starts at <paramref name="start"/> ends, or
  /// <paramref name="start"/> when the text does not carry a complete tag
  /// there.
  ///
  /// Quoted attribute values are scanned through, because serializing an
  /// element does NOT escape <c>&gt;</c> inside an attribute value —
  /// <c>&lt;a title="a&gt;b"&gt;</c> is a single tag and splitting it at the
  /// first <c>&gt;</c> would hand half of it to the diff.
  /// </summary>
  private static int TagEnd(string text, int start)
  {
    var index = start + 1;

    if (CharAt(text, index) == '/')
    {
      index++;
    }

    var nameStart = CharAt(text, index);

    // `<` followed by anything but a tag name is a literal character the user
    // typed, and must stay one — an atom per code point, exactly as before.
    if (!((nameStart >= 'A' && nameStart <= 'Z') || (nameStart >= 'a' && nameStart <= 'z')))
    {
      return start;
    }

    var quote = '\0';

    while (index < text.Length)
    {
      var code = text[index];
      var wasQuoted = quote != '\0';

      quote = NextQuote(code, quote);

      if (!wasQuoted && quote == '\0' && code == '>')
      {
        return index + 1;
      }

      // A second `<` before any `>`: the first one was literal text.
      if (!wasQuoted && quote == '\0' && code == '<')
      {
        return start;
      }

      index++;
    }

    // Unclosed — a half-typed tag, or text that merely contains a `<`.
    return start;
  }

  /// <summary>
  /// The quote character a tag scanner is inside of after reading
  /// <paramref name="code"/>, or NUL when it is not inside one.
  /// </summary>
  private static char NextQuote(char code, char quote)
  {
    if (quote != '\0')
    {
      return code == quote ? '\0' : quote;
    }

    return code == '"' || code == '\'' ? code : '\0';
  }

  /// <summary>
  /// Where the entity reference that starts at <paramref name="start"/> ends,
  /// or <paramref name="start"/> when there is no complete one there.
  /// </summary>
  private static int EntityEnd(string text, int start)
  {
    var index = start + 1;

    if (CharAt(text, index) == '#')
    {
      index++;
    }

    var limit = Math.Min(text.Length, start + MaxEntityLength);

    for (; index < limit; index++)
    {
      var code = text[index];

      if (code == ';')
      {
        // `&;` is not a reference.
        return index > start + 1 ? index + 1 : start;
      }

      var alphanumeric = (code >= '0' && code <= '9') ||
          (code >= 'A' && code <= 'Z') ||
          (code >= 'a' && code <= 'z');

      if (!alphanumeric)
      {
        return start;
      }
    }

    return start;
  }

  /// <summary>
  /// The character at <paramref name="index"/>, or NUL past the end — what
  /// JavaScript's <c>charCodeAt</c> answers there, which every scanner above
  /// compares against.
  /// </summary>
  private static char CharAt(string text, int index)
  {
    return index >= 0 && index < text.Length ? text[index] : '\0';
  }

  /// <summary>
  /// Splits a string into code points. A well-formed surrogate pair is one
  /// entry; a LONE surrogate stays an entry of its own, because dropping or
  /// replacing it would rewrite text the caller never changed. Mirrors
  /// JavaScript's string iterator, which the client splits with.
  /// </summary>
  private static string[] CodePoints(string value)
  {
    var points = new List<string>(value.Length);

    for (var index = 0; index < value.Length; index++)
    {
      if (char.IsHighSurrogate(value[index]) &&
          index + 1 < value.Length &&
          char.IsLowSurrogate(value[index + 1]))
      {
        points.Add(value.Substring(index, 2));
        index++;

        continue;
      }

      points.Add(value[index].ToString());
    }

    return points.ToArray();
  }

  /// <summary>
  /// Myers over a sequence, bounded by <see cref="MaxDiffDistance"/>. Null when
  /// the two sequences are further apart than the cap allows it to look.
  /// </summary>
  private static TextEdit[]? MyersOps(string[] before, string[] after)
  {
    var limit = Math.Min(before.Length + after.Length, MaxDiffDistance);
    var v = new Dictionary<int, int> { [1] = 0 };
    var trace = new List<Dictionary<int, int>>();

    for (var depth = 0; depth <= limit; depth++)
    {
      trace.Add(new Dictionary<int, int>(v));

      if (ReachesEnd(before, after, v, depth))
      {
        return ToUnitOps(BacktrackMyers(trace, before, after, depth), before);
      }
    }

    return null;
  }

  /// <summary>
  /// Whitespace runs and non-whitespace runs, in order, concatenating back to
  /// <paramref name="text"/>. A word is one element, so a bulk edit that
  /// rewrites words has an edit distance the size of the words it touched
  /// rather than the characters.
  /// </summary>
  private static string[] Tokenize(string text)
  {
    return WordRuns().Matches(text).Select(match => match.Value).ToArray();
  }

  [GeneratedRegex($"[{JsWhitespace}]+|[^{JsWhitespace}]+")]
  private static partial Regex WordRuns();

  /// <summary>
  /// One step of the search: extend every diagonal reachable at
  /// <paramref name="depth"/>, recording how far each one got. True once a path
  /// has consumed both sequences.
  /// </summary>
  private static bool ReachesEnd(string[] before, string[] after, Dictionary<int, int> v, int depth)
  {
    for (var k = -depth; k <= depth; k += 2)
    {
      var down = k == -depth || (k != depth && Reach(v, k - 1) < Reach(v, k + 1));
      var start = down ? Reach(v, k + 1) : Reach(v, k - 1) + 1;
      var x = SlideDiagonal(before, after, start, start - k);

      v[k] = x;

      if (x >= before.Length && x - k >= after.Length)
      {
        return true;
      }
    }

    return false;
  }

  private static int Reach(Dictionary<int, int> v, int k)
  {
    return v.TryGetValue(k, out var x) ? x : 0;
  }

  /// <summary>
  /// How far a Myers step can run along the diagonal: the two sequences agree
  /// element for element from (fromX, fromY) until they do not.
  /// </summary>
  private static int SlideDiagonal(string[] before, string[] after, int fromX, int fromY)
  {
    var reach = Math.Min(before.Length - fromX, after.Length - fromY);
    var matched = 0;

    while (matched < reach &&
           string.Equals(before[fromX + matched], after[fromY + matched], StringComparison.Ordinal))
    {
      matched++;
    }

    return fromX + matched;
  }

  /// <summary>
  /// Walks a Myers trace back into edits, oldest first, then fuses neighbours
  /// so a typed word is one insert and not one per character, and so a delete
  /// with an insert against its end is ONE replacement.
  ///
  /// The delete+insert pair matters: applied separately the new text is
  /// anchored to the RIGHT of the run it replaces, so a peer's concurrent
  /// keystroke inside that run — whose own anchor is a character now
  /// tombstoned — surfaces BEFORE all of it.
  /// </summary>
  private static List<TextEdit> BacktrackMyers(
      List<Dictionary<int, int>> trace, string[] before, string[] after, int depth)
  {
    var ops = new List<TextEdit>();
    var x = before.Length;
    var y = after.Length;

    for (var step = depth; step > 0; step--)
    {
      var previous = trace[step];
      var k = x - y;
      var down = k == -step || (k != step && Reach(previous, k - 1) < Reach(previous, k + 1));
      var previousK = down ? k + 1 : k - 1;
      var previousX = Reach(previous, previousK);
      var previousY = previousX - previousK;

      ops.Add(down
          ? new TextEdit(previousX, 0, after[previousY])
          : new TextEdit(previousX, 1, string.Empty));

      x = previousX;
      y = previousY;
    }

    ops.Reverse();

    var fused = new List<TextEdit>(ops.Count);

    foreach (var op in ops)
    {
      if (fused.Count == 0)
      {
        fused.Add(op);

        continue;
      }

      var last = fused[^1];
      var abuts = last.Index + last.Remove == op.Index;

      if (abuts && last.Insert.Length == 0 && op.Remove == 0)
      {
        fused[^1] = last with { Insert = op.Insert };

        continue;
      }

      if (abuts && last.Remove == 0 && op.Insert.Length == 0)
      {
        fused[^1] = last with { Remove = op.Remove };

        continue;
      }

      if (abuts && (last.Insert.Length == 0) == (op.Insert.Length == 0))
      {
        fused[^1] = last with
        {
          Remove = last.Remove + op.Remove,
          Insert = last.Insert + op.Insert,
        };

        continue;
      }

      fused.Add(op);
    }

    return fused;
  }

  /// <summary>
  /// Re-expresses edits counted in whole units — atoms, or words — as the
  /// code-unit offsets <c>YText</c> indexes by.
  /// </summary>
  private static TextEdit[] ToUnitOps(List<TextEdit> ops, string[] beforeAtoms)
  {
    var unitAt = UnitOffsets(beforeAtoms);

    return ops
        .Select(op => new TextEdit(
            unitAt[op.Index],
            unitAt[op.Index + op.Remove] - unitAt[op.Index],
            op.Insert))
        .ToArray();
  }

  /// <summary>
  /// Where each atom starts, in the code-unit offsets <c>YText</c> indexes by,
  /// with one extra entry for the end of the string.
  /// </summary>
  private static int[] UnitOffsets(string[] atoms)
  {
    var offsets = new int[atoms.Length + 1];

    for (var index = 0; index < atoms.Length; index++)
    {
      offsets[index + 1] = offsets[index] + atoms[index].Length;
    }

    return offsets;
  }

  /// <summary>
  /// Runs of <see cref="AnchorAtoms"/> atoms that occur exactly once, keyed by
  /// an FNV-1a hash of the run and valued with the atom index it starts at. A
  /// repeated run maps to -1, so a lookup answers "unique, and here" in one
  /// step.
  ///
  /// Hashes, not the runs themselves: slicing a key string per position is far
  /// more expensive on a large rewrite. A hash can collide, so
  /// <see cref="Anchors"/> re-reads the two runs and compares them before
  /// trusting a pair.
  /// </summary>
  private static Dictionary<uint, int> SingleOccurrences(string text, int[] unitAt)
  {
    var found = new Dictionary<uint, int>();
    var last = unitAt.Length - AnchorAtoms;

    for (var index = 0; index < last; index++)
    {
      var hash = FnvOffsetBasis;

      for (var at = unitAt[index]; at < unitAt[index + AnchorAtoms]; at++)
      {
        unchecked
        {
          hash = (hash ^ text[at]) * FnvPrime;
        }
      }

      found[hash] = found.ContainsKey(hash) ? -1 : index;
    }

    return found;
  }

  /// <summary>
  /// Where the two texts can only be each other: runs of atoms occurring
  /// exactly once on both sides, longest increasing run only so the matches
  /// stay in order. Patience diff's anchor step, over atoms rather than lines —
  /// a block has no lines, and a CJK one has no words either.
  /// </summary>
  private static List<(int Before, int After)> Anchors(
      string before, string after, int[] beforeUnits, int[] afterUnits)
  {
    var uniqueInBefore = SingleOccurrences(before, beforeUnits);
    var uniqueInAfter = SingleOccurrences(after, afterUnits);
    var pairs = new List<(int Before, int After)>();

    foreach (var (run, index) in uniqueInBefore)
    {
      var inAfter = uniqueInAfter.TryGetValue(run, out var found) ? found : -1;

      if (index < 0 || inAfter < 0)
      {
        continue;
      }

      // The hash can collide; the runs themselves decide.
      if (string.Equals(
              before[beforeUnits[index]..beforeUnits[index + AnchorAtoms]],
              after[afterUnits[inAfter]..afterUnits[inAfter + AnchorAtoms]],
              StringComparison.Ordinal))
      {
        pairs.Add((index, inAfter));
      }
    }

    // Every surviving run starts at an index of its own, so ordering by the
    // `before` index is total and the pass does not depend on how the hash
    // table enumerates.
    pairs.Sort((left, right) => left.Before.CompareTo(right.Before));

    // Patience sort: `piles[length - 1]` is the smallest `after` index any
    // increasing run of that length can end on, and `previous` chains the run
    // back so the winner can be walked out.
    var piles = new List<int>();
    var tails = new List<int>();
    var previous = new int[pairs.Count];

    for (var pairIndex = 0; pairIndex < pairs.Count; pairIndex++)
    {
      var afterIndex = pairs[pairIndex].After;
      var low = 0;
      var high = piles.Count;

      while (low < high)
      {
        var middle = (low + high) >> 1;

        if (piles[middle] < afterIndex)
        {
          low = middle + 1;
        }
        else
        {
          high = middle;
        }
      }

      if (low == piles.Count)
      {
        piles.Add(afterIndex);
        tails.Add(pairIndex);
      }
      else
      {
        piles[low] = afterIndex;
        tails[low] = pairIndex;
      }

      previous[pairIndex] = low > 0 ? tails[low - 1] : -1;
    }

    var chosen = new List<(int Before, int After)>();

    for (var at = piles.Count == 0 ? -1 : tails[piles.Count - 1]; at >= 0; at = previous[at])
    {
      chosen.Add(pairs[at]);
    }

    chosen.Reverse();

    return chosen;
  }

  /// <summary>
  /// The one changed region: everything between the common prefix and the
  /// common suffix, both ends rolled back off a surrogate pair. Mirrors
  /// <c>lib0</c>'s <c>simpleDiffString</c>, which the client uses here.
  /// </summary>
  private static (int Index, int Remove, string Insert) SingleRegion(string before, string after)
  {
    var shortest = Math.Min(before.Length, after.Length);
    var prefix = 0;

    while (prefix < shortest && before[prefix] == after[prefix])
    {
      prefix++;
    }

    if (prefix > 0 && char.IsHighSurrogate(before[prefix - 1]))
    {
      prefix--;
    }

    var suffix = 0;

    while (suffix < shortest - prefix &&
           before[before.Length - 1 - suffix] == after[after.Length - 1 - suffix])
    {
      suffix++;
    }

    if (suffix > 0 && char.IsLowSurrogate(before[before.Length - suffix]))
    {
      suffix--;
    }

    return (prefix,
        before.Length - prefix - suffix,
        after.Substring(prefix, after.Length - prefix - suffix));
  }
}
