using System.Globalization;
using System.Text;
using Blok.Server.Mcp.Live;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>
/// The Y.UndoManager port against yjs 13.6.33. Every expected value was printed by
/// the same scenario run on node_modules/yjs with client ids 1 and 2, gc off,
/// captureTimeout 0 and the 'local' origin tracked.
/// </summary>
public sealed class LiveUndoManagerTests
{
  private static readonly object Local = new();

  [Fact]
  public void UndoKeepsAPeerWriteToAnotherKey()
  {
    var (a, b, undo) = Pair();

    Write(a, undo, Local, tx =>
    {
      var block = new YMap();

      a.GetMap("blocks").Set(tx, "h1", block);
      block.Set(tx, "text", "Title");
      block.Set(tx, "level", 2.0);
    });
    Sync(a, b);
    Write(a, undo, Local, tx => Block(a, "h1").Set(tx, "text", "New title"));
    Sync(a, b);
    b.Transact(tx => Block(b, "h1").Set(tx, "level", 3.0));
    Sync(a, b);

    undo.Undo();
    Assert.Equal("{h1:{level:3,text:Title}}", Json(a.GetMap("blocks")));
    Sync(a, b);
    undo.Redo();
    Assert.Equal("{h1:{level:3,text:New title}}", Json(a.GetMap("blocks")));
    Sync(a, b);
    undo.Undo();
    undo.Undo();
    Assert.Equal("{}", Json(a.GetMap("blocks")));
    undo.Redo();
    Assert.Equal("{h1:{level:3,text:Title}}", Json(a.GetMap("blocks")));
    Assert.Equal("1:10,2:1", States(a));
    Sync(a, b);
    Assert.Equal("{h1:{level:3,text:Title}}", Json(b.GetMap("blocks")));
    Assert.Single(undo.UndoStack);
    Assert.Single(undo.RedoStack);
  }

  [Fact]
  public void UndoAndRedoKeepAPeerTextAndFollowASplitRun()
  {
    var (a, b, undo) = Pair();

    Write(a, undo, Local, tx =>
    {
      var block = new YMap();

      a.GetMap("blocks").Set(tx, "p1", block);
      var text = new YText();

      block.Set(tx, "text", text);
      text.Insert(tx, 0, "Hello");
    });
    Write(a, undo, Local, tx => Text(a).Insert(tx, 0, ">> "));
    Sync(a, b);
    b.Transact(tx => Text(b).Insert(tx, 8, " world"));
    Sync(a, b);

    undo.Undo();
    Assert.Equal("Hello world", Text(a).ToString());
    Sync(a, b);
    undo.Redo();
    Assert.Equal(">> Hello world", Text(a).ToString());
    Sync(a, b);
    b.Transact(tx => Text(b).Delete(tx, 1, 1));
    Sync(a, b);
    undo.Undo();
    Assert.Equal("Hello world", Text(a).ToString());
    undo.Redo();
    Assert.Equal("> Hello world", Text(a).ToString());
    undo.Undo();
    undo.Undo();
    Assert.Equal("{}", Json(a.GetMap("blocks")));
    undo.Redo();
    Assert.Equal("{p1:{text:Hello world}}", Json(a.GetMap("blocks")));
    undo.Redo();
    Assert.Equal("{p1:{text:> Hello world}}", Json(a.GetMap("blocks")));
    Assert.Equal("1:30,2:6", States(a));
    Sync(a, b);
    Assert.Equal("{p1:{text:> Hello world}}", Json(b.GetMap("blocks")));
  }

  [Fact]
  public void RedoBringsBackAMoveAPeerUndidByRemoving()
  {
    var (a, b, undo) = Pair();

    Write(a, undo, Local, tx => a.GetArray("root").Insert(tx, 0, ["p1", "p2"]));
    Write(a, undo, Local, tx =>
    {
      a.GetArray("root").Delete(tx, 1, 1);
      a.GetArray("root").Insert(tx, 0, ["p2"]);
    });
    Sync(a, b);
    undo.Undo();
    Assert.Equal("[p1,p2]", Json(a.GetArray("root")));
    Sync(a, b);
    b.Transact(tx => b.GetArray("root").Delete(tx, 1, 1));
    Sync(a, b);
    undo.Redo();
    Assert.Equal("[p2,p1]", Json(a.GetArray("root")));
    undo.Undo();
    Assert.Equal("[p1]", Json(a.GetArray("root")));
    Assert.Equal("1:5", States(a));
    Assert.Single(undo.UndoStack);
    Assert.Single(undo.RedoStack);
  }

  [Fact]
  public void AnUntrackedWriteIsNoStep()
  {
    var (a, _, undo) = Pair();

    Write(a, undo, new object(), tx => a.GetArray("root").Insert(tx, 0, ["x"]));

    Assert.Empty(undo.UndoStack);
    Assert.Null(undo.Undo());
  }

  private static (YDoc A, YDoc B, LiveUndoManager Undo) Pair()
  {
    var a = new YDoc(1) { Gc = false };
    var b = new YDoc(2) { Gc = false };
    LiveUndoManager? undo = null;

    undo = new LiveUndoManager(
        a,
        [a.GetMap("blocks"), a.GetArray("root")],
        origin => ReferenceEquals(origin, Local),
        (origin, body) => Write(a, undo!, origin, body));

    return (a, b, undo);
  }

  // As LiveRoom.WriteLocal: one transaction, then the observer when it changed something.
  private static void Write(YDoc doc, LiveUndoManager undo, object origin, Action<YTransaction> body)
  {
    YTransaction? seen = null;

    if (doc.Transact(tx =>
    {
      seen = tx;
      body(tx);
    }) is not null)
    {
      undo.AfterTransaction(origin, seen!);
    }
  }

  private static void Sync(YDoc a, YDoc b)
  {
    b.ApplyUpdate(a.EncodeStateAsUpdate(b.EncodeStateVector()));
    a.ApplyUpdate(b.EncodeStateAsUpdate(a.EncodeStateVector()));
  }

  private static YMap Block(YDoc doc, string id)
  {
    Assert.True(doc.GetMap("blocks").TryGet(id, out var block));

    return Assert.IsType<YMap>(block);
  }

  private static YText Text(YDoc doc)
  {
    Assert.True(Block(doc, "p1").TryGet("text", out var text));

    return Assert.IsType<YText>(text);
  }

  private static string States(YDoc doc) =>
      string.Join(",", doc.Store.Clients.OrderBy(entry => entry.Key).Select(entry => $"{entry.Key}:{doc.Store.GetState(entry.Key)}"));

  // Keys sorted, strings bare: enough to compare with yjs's toJSON.
  private static string Json(object? value)
  {
    switch (value)
    {
      case YMap map:
        var builder = new StringBuilder("{");

        builder.AppendJoin(",", map.Keys.Order(StringComparer.Ordinal).Select(key =>
        {
          map.TryGet(key, out var entry);

          return $"{key}:{Json(entry)}";
        }));

        return builder.Append('}').ToString();
      case YArray array:
        return $"[{string.Join(",", array.Enumerate().Select(Json))}]";
      case YText text:
        return text.ToString();
      case double number:
        return number.ToString(CultureInfo.InvariantCulture);
      default:
        return value?.ToString() ?? "null";
    }
  }
}
