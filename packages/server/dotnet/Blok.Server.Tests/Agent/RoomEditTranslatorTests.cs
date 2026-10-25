using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class RoomEditTranslatorTests
{
  [Fact]
  public void TranslatesEachEditKind()
  {
    var edits = JsonNode.Parse("""
      [
        {"op":"insert","parentId":null,"afterId":"p","block":{"id":"n","type":"toggle","data":{"text":[]},"children":[{"id":"n1","type":"paragraph","data":{},"children":[]}]}},
        {"op":"setRichText","id":"p","field":"text","value":[{"text":"x"}]},
        {"op":"setData","id":"p","patch":{"keep":null}},
        {"op":"move","id":"q","parentId":"n","afterId":"n1"},
        {"op":"setPageField","key":"title","value":"T"}
      ]
      """)!.AsArray();
    var after = JsonNode.Parse("""
      {"title":"T","blocks":[
        {"id":"p","type":"paragraph","data":{"text":[{"text":"x"}]},"lastEditedAt":7,"lastEditedBy":"agent"},
        {"id":"n","type":"toggle","data":{"text":[]},"content":["n1","q"],"lastEditedAt":7,"lastEditedBy":"agent"},
        {"id":"n1","type":"paragraph","data":{},"parent":"n","lastEditedAt":7,"lastEditedBy":"agent"},
        {"id":"q","type":"paragraph","data":{},"parent":"n"}
      ]}
      """)!.AsObject();
    var result = JsonNode.Parse("""{"ok":true,"changed":{"created":["n","n1"],"updated":["p"],"moved":["q"],"removed":[]}}""")!.AsObject();

    var ops = RoomEditTranslator.Translate(edits, after, result);

    Assert.Collection(ops,
        op => Assert.Equal(("n", "p", (string?)null), (((CollabEditOp.Insert)op).Id, ((CollabEditOp.Insert)op).After, ((CollabEditOp.Insert)op).Parent)),
        op => Assert.Equal(("n1", (string?)null, "n"), (((CollabEditOp.Insert)op).Id, ((CollabEditOp.Insert)op).After, ((CollabEditOp.Insert)op).Parent)),
        op => Assert.Equal("""{"text":[{"text":"x"}]}""", ((CollabEditOp.Update)op).Data.ToJsonString()),
        op => Assert.Equal(new CollabEditOp.Move("q", "n1", "n"), op),
        op => Assert.Equal("title", ((CollabEditOp.SetPageField)op).Key),
        op => Assert.Equal(new CollabEditOp.SetMetadata("n", 7, "agent"), op),
        op => Assert.Equal(new CollabEditOp.SetMetadata("n1", 7, "agent"), op),
        op => Assert.Equal(new CollabEditOp.SetMetadata("p", 7, "agent"), op));
  }

  [Fact]
  public void CarriesTheCoAuthorIdsTheJsonApplierWrote()
  {
    var edits = JsonNode.Parse("""
      [
        {"op":"insert","parentId":null,"afterId":null,"block":{"id":"n","type":"paragraph","data":{},"children":[]}},
        {"op":"setData","id":"p","patch":{"keep":1}}
      ]
      """)!.AsArray();
    var after = JsonNode.Parse("""
      {"blocks":[
        {"id":"n","type":"paragraph","data":{},"createdAt":7,"createdBy":"human-1","createdWith":"agent","lastEditedAt":7,"lastEditedBy":"human-1","lastEditedWith":"agent"},
        {"id":"p","type":"paragraph","data":{"keep":1},"lastEditedAt":7,"lastEditedBy":"human-1","lastEditedWith":"agent"}
      ]}
      """)!.AsObject();
    var result = JsonNode.Parse("""{"ok":true,"changed":{"created":["n"],"updated":["p"],"moved":[],"removed":[]}}""")!.AsObject();

    var ops = RoomEditTranslator.Translate(edits, after, result);

    Assert.Collection(ops,
        op => Assert.Equal(("human-1", "agent"), ((string?)((CollabEditOp.Insert)op).Block["createdBy"], (string?)((CollabEditOp.Insert)op).Block["createdWith"])),
        op => Assert.IsType<CollabEditOp.Update>(op),
        op => Assert.Equal(new CollabEditOp.SetMetadata("n", 7, "human-1", "agent"), op),
        op => Assert.Equal(new CollabEditOp.SetMetadata("p", 7, "human-1", "agent"), op));
  }

  [Fact]
  public void ARemoveThatKeepsChildrenLiftsThemAndStampsThem()
  {
    var edits = JsonNode.Parse("""
      [
        {"op":"remove","id":"a","withChildren":false},
        {"op":"remove","id":"b","withChildren":true},
        {"op":"setTunes","id":"a1","tunes":{"align":{"value":"center"},"gone":null}},
        {"op":"replaceType","id":"a2","type":"header","data":{"text":[],"level":2}}
      ]
      """)!.AsArray();
    var after = JsonNode.Parse("""
      {"blocks":[
        {"id":"a1","type":"paragraph","data":{},"tunes":{"align":{"value":"center"}},"lastEditedAt":9,"lastEditedBy":"agent"},
        {"id":"a2","type":"header","data":{"text":[{"text":"H"}],"level":2},"lastEditedAt":9,"lastEditedBy":"agent"}
      ]}
      """)!.AsObject();
    var result = JsonNode.Parse("""{"ok":true,"changed":{"created":[],"updated":["a1","a2"],"moved":["a1","a2"],"removed":["a","b","b1"]}}""")!.AsObject();

    var ops = RoomEditTranslator.Translate(edits, after, result);

    Assert.Collection(ops,
        op => Assert.Equal(new CollabEditOp.Lift("a"), op),
        op => Assert.Equal(new CollabEditOp.Remove("a"), op),
        op => Assert.Equal(new CollabEditOp.Remove("b"), op),
        op => Assert.Equal("""{"align":{"value":"center"},"gone":null}""", ((CollabEditOp.SetTunes)op).Tunes.ToJsonString()),
        op => Assert.Equal(("header", """{"text":[{"text":"H"}],"level":2}"""), (((CollabEditOp.Retype)op).Type, ((CollabEditOp.Retype)op).Data.ToJsonString())),
        op => Assert.Equal(new CollabEditOp.SetMetadata("a1", 9, "agent"), op),
        op => Assert.Equal(new CollabEditOp.SetMetadata("a2", 9, "agent"), op));
  }
}
