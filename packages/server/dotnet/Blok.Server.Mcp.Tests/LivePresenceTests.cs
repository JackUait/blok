using System.Text.Json.Nodes;
using Blok.Server.Mcp.Live;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class LivePresenceTests
{
  [Fact]
  public void TheColorComesFromTheActorIdHashAsInNode()
  {
    // Recorded from Node in live.json.
    Assert.Equal("#8f3a1c", LivePresence.ColorFor("agent:alice:claude-code"));
  }

  [Fact]
  public void ActivityGoesOutOncePerMinuteAndOnlyWhenTheSocketTookIt()
  {
    var time = DateTimeOffset.UnixEpoch;
    var sent = 0;
    var ready = false;
    var presence = new LivePresence((_, _) => { }, () => ready && ++sent > 0, new JsonObject { ["id"] = "a" }, "a", () => time);
    var result = new JsonObject { ["ok"] = true, ["changed"] = new JsonObject() };

    presence.AfterBatch(result);
    ready = true;
    presence.AfterBatch(result);
    time += TimeSpan.FromSeconds(59);
    presence.AfterBatch(result);
    time += TimeSpan.FromSeconds(1);
    presence.AfterBatch(result);

    Assert.Equal(2, sent);
  }
}
