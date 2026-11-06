using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>The host echoes the agent's own operation before the ack; it must not count as a doc update.</summary>
public sealed class LiveEchoTests
{
  [Fact]
  public void ApplyingTheOwnUpdateBackEmitsNothing()
  {
    var doc = new YDoc();
    var first = doc.Transact(tx => doc.GetMap("m").Set(tx, "a", "one"))!;
    var second = doc.Transact(tx =>
    {
      doc.GetMap("m").Set(tx, "a", "two");
      doc.GetMap("m").Remove(tx, "b");
      doc.GetMap("m").Set(tx, "c", "three");
    })!;
    var emitted = 0;

    doc.UpdateEmitted += _ => emitted++;
    doc.ApplyUpdate(first);
    doc.ApplyUpdate(second);

    Assert.Equal(0, emitted);
  }

  [Fact]
  public void ApplyingAnEchoThatDeletesEmitsNothing()
  {
    var doc = new YDoc();

    doc.Transact(tx => doc.GetMap("m").Set(tx, "a", "one"));
    var deleting = doc.Transact(tx => doc.GetMap("m").Remove(tx, "a"))!;
    var emitted = 0;

    doc.UpdateEmitted += _ => emitted++;
    doc.ApplyUpdate(deleting);

    Assert.Equal(0, emitted);
  }
}
