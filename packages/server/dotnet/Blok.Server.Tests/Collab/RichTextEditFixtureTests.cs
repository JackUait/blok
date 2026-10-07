using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The shared rich-text edit fixtures (README in that directory): the same
/// (current, next) pairs drive the client write path, and both sides must
/// issue exactly the fixture's ops. The TS suite replays those ops in real
/// yjs and pins the resulting delta and segments, so this test checks the
/// planner, the engine and the converter against yjs at once.
/// </summary>
public sealed class RichTextEditFixtureTests
{
  private const string Cases = "rich-text-edits/cases.json";

  public static TheoryData<string> CaseNames()
  {
    return new TheoryData<string>(All().Select(entry => Field<string>(entry, "name")));
  }

  [Theory]
  [MemberData(nameof(CaseNames))]
  public void PlansExactlyTheFixtureOps(string name)
  {
    var entry = Case(name);
    var doc = SeededWith(Field<AnyArray>(entry, "current"));
    var next = RichText.ReadInput(Field<AnyArray>(entry, "next"));
    var ops = RichTextEdit.Plan(LiveText(doc).ToDelta(), next);

    Assert.Equal(JsJson.Stringify(Field<AnyArray>(entry, "ops")), JsJson.Stringify(OpsJson(ops)));
  }

  [Theory]
  [MemberData(nameof(CaseNames))]
  public void AnUpdateLeavesTheDeltaYjsLeaves(string name)
  {
    var entry = Case(name);
    var expected = Field<AnyObject>(entry, "expected");
    var doc = SeededWith(Field<AnyArray>(entry, "current"));
    var updates = 0;
    var data = new AnyObject();

    data.Add("text", Field<AnyArray>(entry, "next"));
    doc.UpdateEmitted += _ => updates++;

    YDocConverter.ApplyOps(doc, CollabEditOps.Parse(System.Text.Encoding.UTF8.GetBytes(
        $$"""{ "ops": [{ "op": "update", "id": "b1", "data": {{JsJson.Stringify(data)}} }] }""")));

    // The no-write assertion first: it is what the "writes" flag exists for.
    Assert.Equal(Field<bool>(expected, "writes") ? 1 : 0, updates);
    Assert.Equal(JsJson.Stringify(Field<AnyArray>(expected, "delta")), JsJson.Stringify(DeltaJson(LiveText(doc))));
    Assert.Equal(
        JsJson.Stringify(Field<AnyArray>(expected, "segments")),
        JsJson.Stringify(RichText.FromDelta(LiveText(doc).ToDelta())));
  }

  internal static AnyArray OpsJson(IReadOnlyList<RichTextOp> ops)
  {
    var result = new AnyArray();

    foreach (var op in ops)
    {
      var json = new AnyObject();

      switch (op)
      {
        case RichTextOp.Insert insert:
          json.Add("op", "insert");
          json.Add("index", (double)insert.Index);
          json.Add("text", insert.Text);
          json.Add("attributes", insert.Attributes);
          break;

        case RichTextOp.InsertEmbed embed:
          json.Add("op", "insertEmbed");
          json.Add("index", (double)embed.Index);
          json.Add("embed", embed.Embed);
          json.Add("attributes", embed.Attributes);
          break;

        case RichTextOp.Delete delete:
          json.Add("op", "delete");
          json.Add("index", (double)delete.Index);
          json.Add("length", (double)delete.Length);
          break;

        case RichTextOp.Format format:
          json.Add("op", "format");
          json.Add("index", (double)format.Index);
          json.Add("length", (double)format.Length);
          json.Add("attributes", format.Attributes);
          break;
      }

      result.Add(json);
    }

    return result;
  }

  /// <summary><c>toDelta()</c> as yjs returns it: no attributes key on an unmarked run.</summary>
  internal static AnyArray DeltaJson(YXmlText text)
  {
    var result = new AnyArray();

    foreach (var op in text.ToDelta())
    {
      var json = new AnyObject();

      json.Add("insert", op.Insert);

      if (op.Attributes is not null)
      {
        json.Add("attributes", op.Attributes);
      }

      result.Add(json);
    }

    return result;
  }

  private static YDoc SeededWith(AnyArray current)
  {
    var data = new AnyObject();

    data.Add("text", current);

    var doc = new YDoc();

    YDocConverter.Seed(doc, (System.Text.Json.Nodes.JsonArray)System.Text.Json.Nodes.JsonNode.Parse(
        $$"""[{ "id": "b1", "type": "paragraph", "data": {{JsJson.Stringify(data)}} }]""")!);

    return doc;
  }

  private static YXmlText LiveText(YDoc doc)
  {
    doc.GetMap("blocks").TryGet("b1", out var block);
    ((YMap)block!).TryGet("data", out var data);
    ((YMap)data!).TryGet("text", out var text);

    return (YXmlText)text!;
  }

  private static IEnumerable<AnyObject> All()
  {
    return ((AnyArray)RichTextFixtures.ReadEngine(Cases)!).Cast<AnyObject>();
  }

  private static AnyObject Case(string name)
  {
    return All().Single(entry => Field<string>(entry, "name") == name);
  }

  private static T Field<T>(AnyObject entry, string key)
  {
    entry.TryGet(key, out var value);

    return (T)value!;
  }
}
