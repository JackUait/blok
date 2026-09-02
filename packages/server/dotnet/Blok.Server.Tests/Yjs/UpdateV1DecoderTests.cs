using System.Globalization;
using System.Numerics;
using System.Text.Json.Nodes;
using Blok.Server.Tests.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The standalone v1 update decoder against every corpus of real bytes the
/// repository holds: structs.json (one update per struct and content shape,
/// with the structure Y.decodeUpdate reports), the 20 collab fixtures
/// (yjs-encoded), yrs-compat.json (yrs-encoded), and negative.json (updates
/// that must be refused, several of which real yjs accepts).
///
/// The golden comparison renders the decoded update back into the generator's
/// JSON shape, so a mis-ported wire rule shows up as a diff rather than as a
/// silently different tree. Values speak the generator's sentinel vocabulary
/// ({"$undefined":true}, {"$num":"NaN"}, {"$bigint":"1"}, {"$u8":"<base64>"}).
/// </summary>
public sealed class UpdateV1DecoderTests
{
  /// <summary>Item info bits: origin, right origin, parentSub.</summary>
  private const byte OriginBit = 0x80;

  private const byte ParentSubBit = 0x20;

  private const ulong PinnedClient = 1000;

  /// <summary>The yrs cases carrying an integer past lib0's tag-125 bound.</summary>
  private static readonly string[] YrsIntegerTagCases = ["array-kinds", "edit-metadata"];

  public static TheoryData<string> StructsCases()
  {
    return new TheoryData<string>(FixtureNames("structs.json"));
  }

  public static TheoryData<string> CollabCases()
  {
    return new TheoryData<string>(YDocConverterFixtures.CaseNames());
  }

  public static TheoryData<string> YrsCases()
  {
    return new TheoryData<string>(FixtureNames("yrs-compat.json"));
  }

  public static TheoryData<string> NegativeCases()
  {
    return new TheoryData<string>(FixtureNames("negative.json"));
  }

  /// <summary>Both byte corpora, tagged by file so a failure names one case.</summary>
  public static TheoryData<string> ReEncodableCases()
  {
    return new TheoryData<string>(
        FixtureNames("structs.json").Select(name => $"structs.json:{name}")
            .Concat(FixtureNames("yrs-compat.json").Select(name => $"yrs-compat.json:{name}")));
  }

  [Theory]
  [MemberData(nameof(StructsCases))]
  public void DecodesEveryStructsGolden(string name)
  {
    var golden = Case("structs.json", name);

    var decoded = UpdateV1Decoder.Decode(Update(golden));

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(golden["decoded"]),
        YjsEngineFixtures.Canonicalize(Render(decoded)));
  }

  [Theory]
  [MemberData(nameof(CollabCases))]
  public void DecodesEveryCollabFixture(string name)
  {
    var update = YDocConverterFixtures.Load(name).Update;

    // yjs-written, so identity holds here as it does for structs.json; two of
    // these carry the parentSub bit with no parentSub bytes.
    Assert.Equal(update, ReEncode(UpdateV1Decoder.Decode(update)));
  }

  [Theory]
  [MemberData(nameof(YrsCases))]
  public void DecodesEveryYrsEncodedFixture(string name)
  {
    // Every working set this server ever persisted was yrs-encoded, so none
    // may be refused. What the bytes decode to is pinned by
    // DecodeThenWriteIsByteIdentical, which carries this corpus too.
    var decoded = UpdateV1Decoder.Decode(Update(Case("yrs-compat.json", name)));

    // The seeds these were captured from reject a NUL, so a string boundary
    // read one byte off would show up here.
    Assert.False(decoded.ContainsNul(), $"{name} decoded a NUL that its seed refused");
  }

  [Theory]
  [MemberData(nameof(NegativeCases))]
  public void RejectsEveryNegativeGolden(string name)
  {
    var golden = Case("negative.json", name);
    var reason = golden["reason"]!.GetValue<string>();

    var refused = Assert.Throws<Lib0FormatException>(() =>
        UpdateV1Decoder.Decode(Update(golden)));

    Assert.Contains(ReasonText(reason), refused.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void ParentIsAbsentWhenAnOriginBitIsSet()
  {
    // The second item overwrites a map key, so yjs writes the parentSub BIT
    // (its item has one) but no parent and no parentSub bytes.
    var decoded = UpdateV1Decoder.Decode(Update(Case("structs.json", "map-key-overwrite")));
    var overwrite = decoded.Structs[PinnedClient][1];

    Assert.NotNull(overwrite.Origin);
    Assert.Null(overwrite.ParentRoot);
    Assert.Null(overwrite.ParentId);
    Assert.Null(overwrite.ParentSub);
    Assert.NotEqual(0, overwrite.Info & ParentSubBit);
    Assert.NotEqual(0, overwrite.Info & OriginBit);
  }

  [Fact]
  public void SkipLengthIsARawVarUint()
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint(1);
    writer.WriteVarUint(2);
    writer.WriteVarUint(PinnedClient);
    writer.WriteVarUint(0);
    writer.WriteUint8(10);
    // 300 needs two varuint bytes; a length-encoding that read one would
    // leave the following struct misaligned instead of failing loudly.
    writer.WriteVarUint(300);
    writer.WriteUint8(0x08);
    writer.WriteVarUint(1);
    writer.WriteVarString("m");
    writer.WriteVarUint(1);
    AnyCodec.Write(writer, "v");
    writer.WriteVarUint(0);

    var decoded = UpdateV1Decoder.Decode(writer.ToArray());
    var structs = decoded.Structs[PinnedClient];

    Assert.Equal(DecodedStructKind.Skip, structs[0].Kind);
    Assert.Equal(300, structs[0].Length);
    Assert.Equal(300UL, structs[1].Id.Clock);
  }

  [Fact]
  public void ContainsNulSeesKeysValuesAndParentSub()
  {
    Assert.False(
        UpdateV1Decoder.Decode(MapKey("k", "v")).ContainsNul(),
        "a NUL-free update reports one");

    foreach (var (what, update) in NulBearingUpdates())
    {
      Assert.True(
          UpdateV1Decoder.Decode(update).ContainsNul(),
          $"the NUL in {what} went unseen");
    }
  }

  /// <summary>
  /// Byte identity everywhere except the two yrs cases below: yrs tags every
  /// integer 125 and writes it as a varint, while lib0 caps tag 125 at
  /// |n| &lt;= 0x7FFFFFFF and writes anything larger as a float. The engine
  /// follows lib0, so those re-encode to the same values under different
  /// number tags; they still have to survive the trip unchanged.
  /// </summary>
  [Theory]
  [MemberData(nameof(ReEncodableCases))]
  public void DecodeThenWriteIsByteIdentical(string tagged)
  {
    var separator = tagged.IndexOf(':', StringComparison.Ordinal);
    var name = tagged[(separator + 1)..];
    var update = Update(Case(tagged[..separator], name));
    var decoded = UpdateV1Decoder.Decode(update);
    var written = ReEncode(decoded);

    if (!tagged.StartsWith("yrs-compat.json:", StringComparison.Ordinal) ||
        !YrsIntegerTagCases.Contains(name, StringComparer.Ordinal))
    {
      Assert.Equal(update, written);
    }

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(Render(decoded)),
        YjsEngineFixtures.Canonicalize(Render(UpdateV1Decoder.Decode(written))));
  }

  /// <summary>
  /// Refs 2 and 9 appear in no fixture and refs 5, 6 and a named 7 appear in
  /// no yrs one, so the hand-built NUL corpus is where their write side is
  /// exercised.
  /// </summary>
  [Fact]
  public void EveryHandBuiltContentRefSurvivesAWriteBack()
  {
    foreach (var (what, update) in NulBearingUpdates().Concat(JsonPayloadUpdates()))
    {
      var written = ReEncode(UpdateV1Decoder.Decode(update));

      Assert.True(
          update.AsSpan().SequenceEqual(written),
          $"the update carrying {what} did not write back byte for byte");
    }
  }

  /// <summary>
  /// Only the first struct of a client group is ever written at an offset,
  /// and the encoder that does it arrives in Wave 3 — so the content classes
  /// are the only place the rule can be pinned now.
  /// </summary>
  [Fact]
  public void ContentWritesOnlyTheTailAtAnOffset()
  {
    AssertTailMatches(new ContentString("hello"), new ContentString("llo"));
    AssertTailMatches(new ContentAny(["a", "b", "c"]), new ContentAny(["c"]));
    AssertTailMatches(new ContentJson(["1", "2", "3"]), new ContentJson(["3"]));
    AssertTailMatches(new ContentDeleted(5), new ContentDeleted(3));
  }

  /// <summary>
  /// Three refusals real yjs does not make. Each one is a value no encoder
  /// writes, so tolerating it would only let corruption through quietly.
  /// </summary>
  [Fact]
  public void RefusesWireValuesNoEncoderWrites()
  {
    AssertRefused(
        "the parent info",
        // 2 is neither "a root name" (1) nor "a parent id" (0).
        RawStruct(0x08, writer =>
        {
          writer.WriteVarUint(2);
          writer.WriteVarString("m");
          writer.WriteVarUint(1);
          AnyCodec.Write(writer, "v");
        }));

    AssertRefused(
        "is not a shared type ref",
        // Only 0..6 exist, and 7 leaves it unknowable whether a name follows.
        SingleStruct(0x07, "m", "k", writer => writer.WriteVarUint(7)));

    AssertRefused(
        "past int.MaxValue",
        // A GC length lib0 accepts and no buffer can back.
        RawStruct(0, writer => writer.WriteVarUint(1UL << 32)));

    // yjs spreads a subdoc's options into a Doc constructor, so null and
    // undefined are a TypeError there. Its own writer always emits an object.
    AssertRefused("subdocument options", SingleStruct(0x09, "m", "k", writer =>
    {
      writer.WriteVarString("g");
      writer.WriteUint8(126);
    }));

    AssertRefused("subdocument options", SingleStruct(0x09, "m", "k", writer =>
    {
      writer.WriteVarString("g");
      writer.WriteUint8(127);
    }));
  }

  /// <summary>
  /// yjs's v1 decoder runs JSON.parse on ContentJSON, ContentEmbed and
  /// ContentFormat, so every yjs peer refuses a payload that is not JSON.
  /// Accepting one here puts a struct in the store that no peer can read: the
  /// room persists the frame and re-sends it, so every joiner's sync answer
  /// fails from then on, across restarts.
  /// </summary>
  [Fact]
  public void RefusesRawJsonContentNoYjsPeerCanParse()
  {
    AssertRefused("is not JSON", SingleStruct(0x02, "m", "k", writer =>
    {
      writer.WriteVarUint(1);
      writer.WriteVarString("{not json");
    }));

    AssertRefused("is not JSON", SingleStruct(0x05, "m", "k", writer => writer.WriteVarString("nope")));

    AssertRefused("is not JSON", SingleStruct(0x06, "m", "k", writer =>
    {
      writer.WriteVarString("bold");
      writer.WriteVarString("nope");
    }));
  }

  /// <summary>
  /// The check is JSON.parse's, not System.Text.Json's defaults: a lone
  /// surrogate escape is exactly what JSON.stringify writes for an unpaired
  /// surrogate, and a browser round-trips duplicate keys, an overflowing
  /// exponent and deep nesting without complaint. Refusing any of these would
  /// drop an update the sender then resends forever.
  /// </summary>
  [Theory]
  [InlineData("\"\\ud800\"")]
  [InlineData("{\"a\":1,\"a\":2}")]
  [InlineData("1e999")]
  [InlineData("[[[[[[[[[[1]]]]]]]]]]")]
  [InlineData("\"undefined\"")]
  public void AcceptsEveryRawJsonPayloadABrowserAccepts(string json)
  {
    var decoded = UpdateV1Decoder.Decode(
        SingleStruct(0x05, "m", "k", writer => writer.WriteVarString(json)));

    Assert.Single(decoded.Structs);
  }

  [Fact]
  public void DeleteSetSortsMergesAndWritesClientsDescending()
  {
    var bytes = DeleteSetBytes(
        (7, [(10, 2), (0, 3), (3, 1), (20, 1)]),
        (9, [(0, 5), (2, 1)]));
    var reader = new Lib0Reader(bytes);

    var set = DeleteSet.Read(ref reader);

    set.SortAndMerge();

    var ranges = set.Clients.ToDictionary(client => client.Key, client => client.Value);

    // (0,3) ends where (3,1) starts, so the two fold together; (2,1) is
    // swallowed whole by (0,5).
    Assert.Equal(
        [new DeleteRange(0, 4), new DeleteRange(10, 2), new DeleteRange(20, 1)],
        ranges[7]);
    Assert.Equal([new DeleteRange(0, 5)], ranges[9]);

    var writer = new Lib0Writer();

    set.Write(writer);

    Assert.Equal(
        DeleteSetBytes((9, [(0, 5)]), (7, [(0, 4), (10, 2), (20, 1)])),
        writer.ToArray());

    var empty = new Lib0Reader(DeleteSetBytes());

    Assert.True(DeleteSet.Read(ref empty).IsEmpty);
  }

  private static byte[] DeleteSetBytes(
      params (ulong Client, (ulong Clock, ulong Length)[] Ranges)[] clients)
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint((ulong)clients.Length);

    foreach (var client in clients)
    {
      writer.WriteVarUint(client.Client);
      writer.WriteVarUint((ulong)client.Ranges.Length);

      foreach (var range in client.Ranges)
      {
        writer.WriteVarUint(range.Clock);
        writer.WriteVarUint(range.Length);
      }
    }

    return writer.ToArray();
  }

  // ---------------------------------------------------------------------
  // A minimal re-encoder, private to this test. The production encoder
  // arrives in Wave 3; this one only proves the decoder kept every byte.
  // ---------------------------------------------------------------------

  private static byte[] ReEncode(DecodedUpdate update)
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint((ulong)update.Structs.Count);

    foreach (var group in update.Structs)
    {
      writer.WriteVarUint((ulong)group.Value.Count);
      writer.WriteVarUint(group.Key);
      // The group's clock is the first struct's: a struct written at an
      // offset decodes with the already-offset clock and length.
      writer.WriteVarUint(group.Value[0].Id.Clock);

      foreach (var decoded in group.Value)
      {
        WriteStruct(writer, decoded);
      }
    }

    update.DeleteSet.Write(writer);

    return writer.ToArray();
  }

  private static void WriteStruct(Lib0Writer writer, DecodedStruct decoded)
  {
    // The raw info byte, never a recomputed one: yjs sets the parentSub bit
    // whenever its item has a parentSub, including when an origin bit
    // suppresses the parentSub bytes.
    writer.WriteUint8(decoded.Info);

    if (decoded.Kind != DecodedStructKind.Item)
    {
      writer.WriteVarUint((ulong)decoded.Length);

      return;
    }

    if (decoded.Origin is { } origin)
    {
      WriteId(writer, origin);
    }

    if (decoded.RightOrigin is { } rightOrigin)
    {
      WriteId(writer, rightOrigin);
    }

    if (decoded.Origin is null && decoded.RightOrigin is null)
    {
      if (decoded.ParentRoot is { } root)
      {
        writer.WriteVarUint(1);
        writer.WriteVarString(root);
      }
      else
      {
        writer.WriteVarUint(0);
        WriteId(writer, decoded.ParentId!.Value);
      }

      if (decoded.ParentSub is { } parentSub)
      {
        writer.WriteVarString(parentSub);
      }
    }

    decoded.Content!.Write(writer, 0);
  }

  private static void WriteId(Lib0Writer writer, YId id)
  {
    writer.WriteVarUint(id.Client);
    writer.WriteVarUint(id.Clock);
  }


  // ---------------------------------------------------------------------
  // Hand-assembled updates
  // ---------------------------------------------------------------------

  /// <summary>
  /// Refs 2 and 5, whose payload is JSON and so cannot carry a raw NUL. They
  /// live here rather than in the NUL corpus so the write side of both is
  /// still exercised.
  /// </summary>
  private static IEnumerable<(string What, byte[] Update)> JsonPayloadUpdates()
  {
    yield return ("a ContentEmbed payload", SingleStruct(0x05, "t", null, writer =>
        writer.WriteVarString("\"a\\u0000b\"")));

    yield return ("a ContentJSON payload", SingleStruct(0x02, "m", "k", writer =>
    {
      writer.WriteVarUint(1);
      writer.WriteVarString("\"a\\u0000b\"");
    }));
  }

  /// <summary>One root-parented map item per NUL-bearing wire position.</summary>
  private static IEnumerable<(string What, byte[] Update)> NulBearingUpdates()
  {
    yield return ("a root name", MapKey("k", "v", root: "r\0t"));
    yield return ("a parentSub", MapKey("k\0", "v"));
    yield return ("an Any string leaf", MapKey("k", "v\0v"));

    yield return ("an Any object key", SingleStruct(0x08, "m", "k", writer =>
    {
      writer.WriteVarUint(1);
      writer.WriteUint8(118);
      writer.WriteVarUint(1);
      writer.WriteVarString("n\0l");
      writer.WriteUint8(126);
    }));

    yield return ("ContentString", SingleStruct(0x04, "t", null, writer =>
        writer.WriteVarString("a\0b")));

    yield return ("a ContentFormat key", SingleStruct(0x06, "t", null, writer =>
    {
      writer.WriteVarString("b\0d");
      writer.WriteVarString("true");
    }));

    // ContentEmbed and ContentJSON payloads are JSON, and JSON.stringify
    // always escapes a NUL, so a raw one can only come from a payload every
    // yjs peer refuses. Their write side is exercised by JsonPayloadUpdates.
    yield return ("an XmlElement node name", SingleStruct(0x07, "m", "k", writer =>
    {
      writer.WriteVarUint(3);
      writer.WriteVarString("d\0v");
    }));

    yield return ("a ContentDoc guid", SingleStruct(0x09, "m", "k", writer =>
    {
      writer.WriteVarString("g\0d");

      // An empty object, which is what yjs's own writer emits: null options
      // are a TypeError on every yjs peer and are refused at decode.
      writer.WriteUint8(118);
      writer.WriteVarUint(0);
    }));
  }

  private static byte[] MapKey(string key, string value, string root = "m")
  {
    return SingleStruct(0x08, root, key, writer =>
    {
      writer.WriteVarUint(1);
      AnyCodec.Write(writer, value);
    });
  }

  /// <summary>
  /// One client, one root-parented struct, an empty delete set. The parentSub
  /// BIT must track the parentSub bytes exactly: setting it without writing
  /// one makes the decoder eat the content as a string.
  /// </summary>
  private static byte[] SingleStruct(
      byte contentRef, string root, string? parentSub, Action<Lib0Writer> content)
  {
    return RawStruct(
        (byte)(contentRef | (parentSub is null ? 0 : ParentSubBit)),
        writer =>
        {
          writer.WriteVarUint(1);
          writer.WriteVarString(root);

          if (parentSub is not null)
          {
            writer.WriteVarString(parentSub);
          }

          content(writer);
        });
  }

  /// <summary>One client, one struct, an empty delete set — everything after
  /// the info byte is the caller's.</summary>
  private static byte[] RawStruct(byte info, Action<Lib0Writer> body)
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint(1);
    writer.WriteVarUint(1);
    writer.WriteVarUint(PinnedClient);
    writer.WriteVarUint(0);
    writer.WriteUint8(info);
    body(writer);
    writer.WriteVarUint(0);

    return writer.ToArray();
  }

  private static void AssertRefused(string reason, byte[] update)
  {
    var refused = Assert.Throws<Lib0FormatException>(() => UpdateV1Decoder.Decode(update));

    Assert.Contains(reason, refused.Message, StringComparison.Ordinal);
  }

  /// <summary>Writing <paramref name="whole"/> past its first two ticks must
  /// give exactly what <paramref name="tail"/> writes whole.</summary>
  private static void AssertTailMatches(YContent whole, YContent tail)
  {
    var written = new Lib0Writer();
    var expected = new Lib0Writer();

    whole.Write(written, 2);
    tail.Write(expected, 0);

    Assert.Equal(expected.ToArray(), written.ToArray());
  }

  // ---------------------------------------------------------------------
  // Fixture plumbing and the golden renderer
  // ---------------------------------------------------------------------

  private static IEnumerable<string> FixtureNames(string file)
  {
    return YjsEngineFixtures.Cases(file)
        .Select(node => node?["name"]?.GetValue<string>() ??
            throw new InvalidDataException($"{file} holds a case with no name"));
  }

  private static JsonNode Case(string file, string name)
  {
    return YjsEngineFixtures.Cases(file)
        .FirstOrDefault(node => node?["name"]?.GetValue<string>() == name) ??
        throw new InvalidDataException($"{file} has no case named {name}");
  }

  private static byte[] Update(JsonNode golden)
  {
    return Convert.FromBase64String(golden["update"]!.GetValue<string>());
  }

  /// <summary>The distinctive part of the message each refusal must carry.</summary>
  private static string ReasonText(string reason)
  {
    return reason switch
    {
      "eos" => "remain",
      "integer-out-of-range" => "above 2^53-1",
      "invalid-utf8" => "is not UTF-8",
      "trailing-bytes" => "follow the delete set",
      "duplicate-client" => "is listed twice",
      "unknown-content-ref" => "is not an item content ref",
      // A v1 reader cannot know the payload is v2: its leading 00 reads as
      // zero struct groups and the rest is left over.
      "v2-update" => "follow the delete set",
      _ => throw new InvalidDataException($"negative.json holds reason {reason}"),
    };
  }

  private static JsonObject Render(DecodedUpdate update)
  {
    var structs = new JsonArray();

    foreach (var group in update.Structs)
    {
      foreach (var decoded in group.Value)
      {
        structs.Add(RenderStruct(decoded));
      }
    }

    var deleteSet = new JsonObject();

    foreach (var client in update.DeleteSet.Clients)
    {
      var ranges = new JsonArray();

      foreach (var range in client.Value)
      {
        ranges.Add(new JsonArray(
            JsonValue.Create(range.Clock),
            JsonValue.Create(range.Length)));
      }

      deleteSet[client.Key.ToString(CultureInfo.InvariantCulture)] = ranges;
    }

    return new JsonObject { ["structs"] = structs, ["deleteSet"] = deleteSet };
  }

  private static JsonObject RenderStruct(DecodedStruct decoded)
  {
    var rendered = new JsonObject
    {
      ["kind"] = decoded.Kind switch
      {
        DecodedStructKind.Item => "item",
        DecodedStructKind.Gc => "gc",
        DecodedStructKind.Skip => "skip",
        _ => throw new InvalidDataException($"unknown kind {decoded.Kind}"),
      },
      ["client"] = JsonValue.Create(decoded.Id.Client),
      ["clock"] = JsonValue.Create(decoded.Id.Clock),
      ["length"] = JsonValue.Create(decoded.Length),
    };

    if (decoded.Kind != DecodedStructKind.Item)
    {
      return rendered;
    }

    rendered["origin"] = RenderId(decoded.Origin);
    rendered["rightOrigin"] = RenderId(decoded.RightOrigin);
    rendered["parent"] = decoded.ParentRoot is { } root
        ? new JsonObject { ["root"] = root }
        : decoded.ParentId is { } parent
            ? new JsonObject { ["item"] = RenderId(parent) }
            : null;
    rendered["parentSub"] = decoded.ParentSub is null
        ? null
        : JsonValue.Create(decoded.ParentSub);
    rendered["content"] = RenderContent(decoded.Content!);

    return rendered;
  }

  private static JsonObject? RenderId(YId? id)
  {
    return id is { } value
        ? new JsonObject
        {
          ["client"] = JsonValue.Create(value.Client),
          ["clock"] = JsonValue.Create(value.Clock),
        }
        : null;
  }

  private static JsonObject RenderContent(YContent content)
  {
    var rendered = new JsonObject { ["ref"] = JsonValue.Create((int)content.Ref) };

    switch (content)
    {
      case ContentDeleted deleted:
        rendered["len"] = JsonValue.Create(deleted.Length);
        break;

      case ContentJson json:
        rendered["arr"] = new JsonArray(json.Values.Select(RenderContentJsonValue).ToArray());
        break;

      case ContentBinary binary:
        rendered["bytes"] = JsonValue.Create(Convert.ToBase64String(binary.Bytes));
        break;

      case ContentString text:
        rendered["str"] = JsonValue.Create(text.Text);
        break;

      case ContentEmbed embed:
        rendered["embed"] = JsonNode.Parse(embed.Json);
        break;

      case ContentFormat format:
        rendered["key"] = JsonValue.Create(format.Key);
        rendered["value"] = JsonNode.Parse(format.Json);
        break;

      case ContentType type:
        rendered["typeRef"] = JsonValue.Create(type.TypeRef);

        if (type.Name is { } name)
        {
          rendered[type.TypeRef == 3 ? "nodeName" : "hookName"] = JsonValue.Create(name);
        }

        break;

      case ContentAny any:
        rendered["arr"] = new JsonArray(any.Values.Select(ToFixtureJson).ToArray());
        break;

      case ContentDoc doc:
        rendered["guid"] = JsonValue.Create(doc.Guid);
        rendered["opts"] = ToFixtureJson(doc.Options);
        break;

      default:
        throw new InvalidDataException($"{content.GetType()} is not a content class");
    }

    return rendered;
  }

  /// <summary>ContentJSON is the one place where 'undefined' is a sentinel string.</summary>
  private static JsonNode? RenderContentJsonValue(string raw)
  {
    return string.Equals(raw, "undefined", StringComparison.Ordinal)
        ? new JsonObject { ["$undefined"] = true }
        : JsonNode.Parse(raw);
  }

  private static JsonNode? ToFixtureJson(object? value)
  {
    switch (value)
    {
      case null:
        return null;

      case YUndefined:
        return new JsonObject { ["$undefined"] = true };

      case bool flag:
        return JsonValue.Create(flag);

      case string text:
        return JsonValue.Create(text);

      case double number:
        return NumberToFixtureJson(number);

      case BigInteger big:
        return new JsonObject { ["$bigint"] = big.ToString(CultureInfo.InvariantCulture) };

      case byte[] bytes:
        return new JsonObject { ["$u8"] = Convert.ToBase64String(bytes) };

      case AnyObject members:
        var json = new JsonObject();

        foreach (var pair in members)
        {
          json[pair.Key] = ToFixtureJson(pair.Value);
        }

        return json;

      case AnyArray items:
        var array = new JsonArray();

        foreach (var item in items)
        {
          array.Add(ToFixtureJson(item));
        }

        return array;

      default:
        throw new InvalidDataException($"{value.GetType()} is not an Any value");
    }
  }

  private static JsonNode NumberToFixtureJson(double number)
  {
    if (double.IsNaN(number))
    {
      return new JsonObject { ["$num"] = "NaN" };
    }

    if (double.IsInfinity(number))
    {
      return new JsonObject { ["$num"] = number > 0 ? "Infinity" : "-Infinity" };
    }

    // -0 and 0 canonicalize to the same JSON number, so it needs the sentinel.
    return number == 0 && double.IsNegative(number)
        ? new JsonObject { ["$num"] = "-0" }
        : JsonValue.Create(number);
  }
}
