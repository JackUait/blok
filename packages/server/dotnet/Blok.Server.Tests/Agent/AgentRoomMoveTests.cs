using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class AgentRoomMoveTests
{
  [Fact]
  public void AMoveKeepsAPeersConcurrentTyping()
  {
    var seed = JsonNode.Parse("""[{"id":"t","type":"toggle","data":{"text":[]}},{"id":"p","type":"paragraph","data":{"text":[{"text":"ab"}]}}]""")!.AsArray();
    var server = YDocs.NewClient();
    RichTextRuntime.Seed(server, seed);
    var peer = YDocs.NewClient();
    YDocs.Apply(peer, YDocs.FullState(server));

    // The peer types inside "p" while the server moves "p" into "t"; then they sync both ways.
    RichTextRuntime.ApplyOps(peer, [new CollabEditOp.Update("p", (JsonObject)JsonNode.Parse("""{"text":[{"text":"aXb"}]}""")!)]);
    RichTextRuntime.ApplyOps(server, [new CollabEditOp.Move("p", null, "t")]);
    YDocs.Apply(server, YDocs.FullState(peer));
    YDocs.Apply(peer, YDocs.FullState(server));

    foreach (var doc in new[] { server, peer })
    {
      var blocks = RichTextRuntime.Export(doc);
      var p = blocks.Single(b => b!["id"]!.GetValue<string>() == "p")!;
      Assert.Equal("t", p["parent"]!.GetValue<string>());
      Assert.Equal("""[{"text":"aXb"}]""", p["data"]!["text"]!.ToJsonString());
      Assert.Equal("""["p"]""", blocks.Single(b => b!["id"]!.GetValue<string>() == "t")!["content"]!.ToJsonString());
    }
  }

  [Fact]
  public void ARetypeKeepsAPeersConcurrentTyping()
  {
    var seed = JsonNode.Parse("""[{"id":"p","type":"paragraph","data":{"text":[{"text":"ab"}]}}]""")!.AsArray();
    var server = YDocs.NewClient();
    RichTextRuntime.Seed(server, seed);
    var peer = YDocs.NewClient();
    YDocs.Apply(peer, YDocs.FullState(server));

    RichTextRuntime.ApplyOps(peer, [new CollabEditOp.Update("p", (JsonObject)JsonNode.Parse("""{"text":[{"text":"aXb"}]}""")!)]);
    RichTextRuntime.ApplyOps(server, [new CollabEditOp.Retype("p", "header", (JsonObject)JsonNode.Parse("""{"text":[{"text":"ab"}],"level":2}""")!)]);
    YDocs.Apply(server, YDocs.FullState(peer));
    YDocs.Apply(peer, YDocs.FullState(server));

    foreach (var doc in new[] { server, peer })
    {
      var p = RichTextRuntime.Export(doc).Single()!;
      Assert.Equal("header", p["type"]!.GetValue<string>());
      Assert.Equal("""[{"text":"aXb"}]""", p["data"]!["text"]!.ToJsonString());
    }
  }
}
