using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The runtime structs, the shared-type read paths and the struct store, all
/// driven by hand-built items: nothing integrates anything yet, so a test
/// wires Left/Right/Map itself exactly as an integrator later will.
/// </summary>
public sealed class StructStoreTests
{
  private const ulong Client = 7;

  private static readonly string[] UndeletedKeys = ["run", "single"];

  [Fact]
  public void GetStateIsZeroForAnUnknownClient()
  {
    var store = new StructStore();

    Assert.Equal(0UL, store.GetState(Client));
    Assert.Empty(store.GetStateVector());

    store.AddStruct(NewItem(Client, 0, Any("a", "b")));

    Assert.Equal(2UL, store.GetState(Client));
    Assert.Equal(0UL, store.GetState(Client + 1));
    Assert.Equal(2UL, store.GetStateVector().Get(Client));
  }

  [Fact]
  public void AddStructRejectsAClockGap()
  {
    var store = new StructStore();

    store.AddStruct(NewItem(Client, 0, Any("a", "b")));

    Assert.Throws<InvalidOperationException>(
        () => store.AddStruct(NewItem(Client, 3, Any("c"))));
  }

  [Fact]
  public void AddStructNeverLeavesAnEmptyClientList()
  {
    var store = new StructStore();

    store.AddStruct(NewItem(Client, 0, Any("a")));

    Assert.Throws<InvalidOperationException>(
        () => store.AddStruct(NewItem(Client, 5, Any("b"))));

    // yjs checks contiguity only when the client is already known, so a first
    // struct at a non-zero clock is accepted rather than rejected into an
    // empty list.
    store.AddStruct(NewItem(Client + 1, 5, Any("c")));

    Assert.All(store.Clients, entry => Assert.NotEmpty(entry.Value));
    Assert.Single(store.Clients[Client]);
    Assert.Single(store.Clients[Client + 1]);
  }

  [Fact]
  public void FindLocatesAStructByAnyClockInsideIt()
  {
    var store = new StructStore();
    var first = NewItem(Client, 0, Any("a", "b", "c"));
    var second = new YGc { Id = new YId(Client, 3), Length = 1 };
    var third = NewItem(Client, 4, Any("d", "e", "f", "g", "h"));

    store.AddStruct(first);
    store.AddStruct(second);
    store.AddStruct(third);

    Assert.Same(first, store.Find(new YId(Client, 0)));
    Assert.Same(first, store.Find(new YId(Client, 2)));
    Assert.Same(second, store.Find(new YId(Client, 3)));
    Assert.Same(third, store.Find(new YId(Client, 4)));
    Assert.Same(third, store.Find(new YId(Client, 8)));
    Assert.Equal(2, store.FindIndex(Client, 8));

    Assert.Throws<InvalidOperationException>(() => store.Find(new YId(Client, 9)));
    Assert.Throws<InvalidOperationException>(() => store.Find(new YId(Client + 1, 0)));
  }

  [Fact]
  public void CleanStartSplitsAnItemAndKeepsLastIdArithmetic()
  {
    var store = new StructStore();
    var left = NewItem(Client, 0, Any("a", "b", "c", "d"));
    var lastId = left.LastId;

    store.AddStruct(left);

    var right = store.GetItemCleanStart(new YId(Client, 3));

    Assert.NotSame(left, right);
    Assert.Equal(new YId(Client, 2), left.LastId);
    Assert.Equal(3, left.Length);
    Assert.Equal(3, left.Content.Length);
    Assert.Equal(new YId(Client, 3), right.Id);
    Assert.Equal(left.LastId, right.Origin);
    Assert.Equal(lastId, right.LastId);
    Assert.Equal(1, right.Length);
    Assert.Same(right, left.Right);
    Assert.Same(left, right.Left);

    Assert.Equal(new YStruct[] { left, right }, store.Clients[Client]);
    Assert.Equal(4UL, store.GetState(Client));
    Assert.Same(left, store.Find(new YId(Client, 2)));
    Assert.Same(right, store.Find(new YId(Client, 3)));

    // A clock that already starts a struct never splits again.
    Assert.Same(right, store.GetItemCleanStart(new YId(Client, 3)));
    Assert.Equal(2, store.Clients[Client].Count);
  }

  [Fact]
  public void CleanEndNeverSplitsAGc()
  {
    var store = new StructStore();
    var collected = new YGc { Id = new YId(Client, 0), Length = 5 };

    store.AddStruct(collected);

    Assert.Same(collected, store.GetItemCleanEnd(new YId(Client, 2)));
    Assert.Single(store.Clients[Client]);
    Assert.Equal(5, collected.Length);

    var items = new StructStore();
    var item = NewItem(Client, 0, Any("a", "b", "c", "d", "e"));

    items.AddStruct(item);

    // The clean end hands back the LEFT half: the caller asked for the struct
    // that now ends at that clock.
    Assert.Same(item, items.GetItemCleanEnd(new YId(Client, 2)));
    Assert.Equal(2, items.Clients[Client].Count);
    Assert.Equal(3, item.Length);
    Assert.Equal(new YId(Client, 2), item.LastId);
    Assert.Equal(new YId(Client, 3), items.Clients[Client][1].Id);
  }

  [Fact]
  public void SplitRepointsTheMapHeadWhenSplittingTheLastValue()
  {
    var map = new YMap();
    var head = NewItem(Client, 0, Any("a", "b"));

    head.Parent = map;
    head.ParentSub = "k";
    head.Deleted = true;
    head.Keep = true;
    map.Map["k"] = head;

    var right = head.SplitAt(1);

    Assert.Same(right, map.Map["k"]);
    Assert.Equal("k", right.ParentSub);
    Assert.Same(map, right.Parent);
    Assert.True(right.Deleted);
    Assert.True(right.Keep);

    // With a right neighbour the head is no longer the last value, so the map
    // keeps pointing at the item it already had.
    var other = new YMap();
    var tail = NewItem(Client + 1, 0, Any("z"));
    var withTail = NewItem(Client, 0, Any("a", "b", "c"));

    withTail.Parent = other;
    withTail.ParentSub = "k";
    withTail.Right = tail;
    tail.Left = withTail;
    other.Map["k"] = withTail;

    var middle = withTail.SplitAt(1);

    Assert.Same(withTail, other.Map["k"]);
    Assert.Same(middle, withTail.Right);
    Assert.Same(tail, middle.Right);
    Assert.Same(middle, tail.Left);
    Assert.False(middle.Deleted);

    // An unresolved root-name parent cannot own a map head; a silent skip here
    // would hide an integration ordering bug.
    var orphan = NewItem(Client, 0, Any("a", "b"));

    orphan.Parent = "blocks";
    orphan.ParentSub = "k";

    Assert.Throws<InvalidOperationException>(() => orphan.SplitAt(1));
  }

  [Fact]
  public void ContentStringSpliceReplacesASplitSurrogatePairWithReplacementCharacters()
  {
    var content = new ContentString("ab😀cd");
    var right = Assert.IsType<ContentString>(content.Splice(3));

    // Both halves keep their code-unit count, so no clock drifts.
    Assert.Equal("ab�", content.Text);
    Assert.Equal(3, content.Length);
    Assert.Equal("�cd", right.Text);
    Assert.Equal(3, right.Length);

    var whole = new ContentString("abcd");
    var tail = Assert.IsType<ContentString>(whole.Splice(2));

    Assert.Equal("ab", whole.Text);
    Assert.Equal("cd", tail.Text);

    var any = new ContentAny(["a", "b", "c"]);
    var anyRight = Assert.IsType<ContentAny>(any.Splice(1));

    Assert.Equal(1, any.Length);
    Assert.Equal(new object?[] { "b", "c" }, anyRight.Values);

    var json = new ContentJson(["1", "2", "3"]);
    var jsonRight = Assert.IsType<ContentJson>(json.Splice(2));

    Assert.Equal(2, json.Length);
    Assert.Equal("3", Assert.Single(jsonRight.Values));

    var deleted = new ContentDeleted(5);
    var deletedRight = Assert.IsType<ContentDeleted>(deleted.Splice(2));

    Assert.Equal(2, deleted.Length);
    Assert.Equal(3, deletedRight.Length);

    Assert.Throws<InvalidOperationException>(() => new ContentType(1, null).Splice(0));
    Assert.Throws<InvalidOperationException>(() => new ContentFormat("b", "true").Splice(0));
  }

  [Fact]
  public void MapTryGetReadsTheLastValueOfTheHeadAndSkipsDeleted()
  {
    var map = new YMap();

    map.Map["single"] = NewItem(Client, 0, Any("x"));
    map.Map["run"] = NewItem(Client, 1, Any("p", "q"));
    map.Map["gone"] = Deleted(NewItem(Client, 3, Any("dead")));

    Assert.True(map.TryGet("single", out var single));
    Assert.Equal("x", single);

    // A map head's value is the LAST element of its content, never the first.
    Assert.True(map.TryGet("run", out var run));
    Assert.Equal("q", run);

    Assert.False(map.TryGet("gone", out var gone));
    Assert.Null(gone);
    Assert.False(map.TryGet("absent", out _));

    Assert.Equal(UndeletedKeys, map.Keys.OrderBy(key => key, StringComparer.Ordinal).ToArray());
    Assert.Equal(2, map.Count);
  }

  [Fact]
  public void ArrayEnumerateSkipsDeletedAndNonCountable()
  {
    var array = new YArray();
    var nested = new YMap();

    Chain(
        array,
        NewItem(Client, 0, new ContentAny([1d, 2d])),
        Deleted(NewItem(Client, 2, Any("skipped"))),
        NewItem(Client, 3, new ContentFormat("bold", "true")),
        NewItem(Client, 4, new ContentType(1, null) { Type = nested }),
        NewItem(Client, 5, new ContentString("hi")));

    Assert.Equal(new object?[] { 1d, 2d, nested, "h", "i" }, array.Enumerate());
    Assert.Equal(5, array.Count);
    Assert.Equal(1d, array.Get(0));
    Assert.Same(nested, array.Get(2));
    Assert.Equal("i", array.Get(4));
    Assert.Null(array.Get(5));
    Assert.Null(array.Get(-1));
  }

  [Fact]
  public void TextToStringSkipsFormatsAndEmbeds()
  {
    var text = new YText();

    Chain(
        text,
        NewItem(Client, 0, new ContentString("Hel")),
        NewItem(Client, 3, new ContentFormat("bold", "true")),
        NewItem(Client, 4, new ContentString("lo")),
        NewItem(Client, 6, new ContentEmbed("{\"image\":1}")),
        Deleted(NewItem(Client, 7, new ContentString(" gone"))));

    Assert.Equal("Hello", text.ToString());

    var xmlText = new YXmlText();

    Chain(xmlText, NewItem(Client + 1, 0, new ContentString("xml")));

    Assert.Equal("xml", xmlText.ToString());
  }

  [Fact]
  public void CreateTypeCoversEveryTypeRef()
  {
    Assert.IsType<YArray>(YAbstractType.CreateType(0, null));
    Assert.IsType<YMap>(YAbstractType.CreateType(1, null));
    Assert.IsType<YText>(YAbstractType.CreateType(2, null));
    Assert.Equal("div", Assert.IsType<YXmlElement>(YAbstractType.CreateType(3, "div")).NodeName);
    Assert.IsType<YXmlFragment>(YAbstractType.CreateType(4, null));
    Assert.Equal("hook", Assert.IsType<YXmlHook>(YAbstractType.CreateType(5, "hook")).HookName);
    Assert.IsType<YXmlText>(YAbstractType.CreateType(6, null));

    Assert.Throws<InvalidOperationException>(() => YAbstractType.CreateType(7, null));
  }

  private static ContentAny Any(params object?[] values)
  {
    return new ContentAny(values);
  }

  private static YItem NewItem(ulong client, ulong clock, YContent content)
  {
    return new YItem { Id = new YId(client, clock), Length = content.Length, Content = content };
  }

  private static YItem Deleted(YItem item)
  {
    item.Deleted = true;

    return item;
  }

  /// <summary>Links the items left to right under <paramref name="parent"/>.</summary>
  private static void Chain(YAbstractType parent, params YItem[] items)
  {
    parent.Start = items[0];

    for (var index = 0; index < items.Length; index++)
    {
      items[index].Parent = parent;
      items[index].Left = index == 0 ? null : items[index - 1];
      items[index].Right = index == items.Length - 1 ? null : items[index + 1];
    }
  }
}
