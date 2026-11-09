using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Who wrote a record and who a block stamp credits, captured from C# into
/// fixtures/collab-history/actor-kinds.json and
/// fixtures/collab-edits/stamp-authority.json. Go and Rust read the same files.
/// Set BLOK_WRITE_COLLAB_HISTORY=1 to rewrite them after an intended change.
/// </summary>
public sealed class CollabAttributionCaptureTests
{
  private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

  [Fact]
  public void TheActorKindsMatchTheRules()
  {
    Check("collab-history/actor-kinds.json", ActorKinds());
  }

  [Fact]
  public void TheStampAuthorityMatchesTheRules()
  {
    Check("collab-edits/stamp-authority.json", StampAuthority());
  }

  private static void Check(string relative, JsonObject built)
  {
    var path = RichTextFixtures.PathOf(relative);
    var text = built.ToJsonString(Indented) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_HISTORY") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), $"{relative} is missing; run with BLOK_WRITE_COLLAB_HISTORY=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  private static JsonObject ActorKinds()
  {
    (string Name, string? Actor, bool Agent, string? OnBehalfOf)[] cases =
    [
      ("no actor", null, false, null),
      ("an empty actor", "", false, null),
      ("a person", "u1", false, null),
      ("a ticket user that looks like an MCP agent is a person", "agent:alice:claude-code", false, null),
      ("a ticket user that names a person to pose for is a person", "agent:org:alice:cursor", false, null),
      ("a ticket user of just the prefix is a person", "agent:", false, null),
      ("a ticket user with another case is a person", "Agent:alice:claude-code", false, null),
      ("an in-process agent with its person", "bot-7", true, "carol"),
      ("an in-process agent with no person", "bot-7", true, null),
      ("an in-process agent with an empty person", "bot-7", true, ""),
      ("an in-process agent's id is never read for its person", "agent:alice:claude-code", true, "carol"),
      ("an in-process agent with an agent-looking id and no person", "agent:alice:claude-code", true, null),
      ("an in-process agent with no id", null, true, "carol"),
      ("non-ASCII ids", "é😀", true, "ü"),
    ];

    var written = new JsonArray();

    foreach (var (name, actor, agent, onBehalfOf) in cases)
    {
      var note = CollabActorKinds.Classify(actor, agent, onBehalfOf);
      var (by, with) = CollabActorKinds.Attribution(actor, note);

      written.Add(new JsonObject
      {
        ["name"] = name,
        ["actor"] = actor,
        ["agent"] = agent,
        ["onBehalfOf"] = onBehalfOf,
        ["note"] = note is null ? null : NoteJson(note),
        ["by"] = by,
        ["with"] = with,
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabActorKinds.Classify and .Attribution as C# answers them. Captured by CollabAttributionCaptureTests; do not edit by hand. agent and onBehalfOf are what an in-process agent passes; note is the record's sidecar note; by and with are the block stamps under stamp authority. An actor id's text never makes it an agent.",
      ["cases"] = written,
    };
  }

  internal static JsonObject NoteJson(CollabRecordNote note)
  {
    var json = new JsonObject { ["kind"] = note.Kind };

    if (note.OnBehalfOf is { } person)
    {
      json["onBehalfOf"] = person;
    }

    return json;
  }

  private static JsonObject StampAuthority()
  {
    const double Now = 1762776000000;
    const string Insert =
        """{"ops":[{"op":"insert","id":"b1","block":{"type":"paragraph","data":{"text":"hi"},"createdAt":1,"createdBy":"mallory","createdWith":"agent:x:y","lastEditedAt":2,"lastEditedBy":"mallory","lastEditedWith":"agent:x:y"}}]}""";
    const string Bare = """{"ops":[{"op":"insert","id":"b1","block":{"type":"paragraph","data":{"text":"hi"}}}]}""";
    const string Mixed =
        """{"ops":[{"op":"update","id":"b0","data":{"text":"new"}},{"op":"insert","id":"b1","block":{"type":"paragraph","data":{}},"after":"b0"},{"op":"remove","id":"b2"},{"op":"update","id":"b3","data":{}}]}""";

    (string Name, string? Actor, string Body)[] cases =
    [
      ("a person's insert loses every caller stamp", "u1", Insert),
      ("an insert with no stamps gains them", "u1", Bare),
      ("a ticket user that looks like an agent is credited as itself, with no co-author", "agent:alice:claude-code", Insert),
      ("with no actor only the times are kept", null, Insert),
      ("an update is followed by its stamp; a remove is not stamped", "u1", Mixed),
      ("a ticket user that looks like an agent stamps an update as itself", "agent:alice:claude-code", Mixed),
      ("with no actor an update gets no stamp", null, Mixed),
    ];

    var written = new JsonArray();

    foreach (var (name, actor, body) in cases)
    {
      var ops = CollabStampAuthority.Apply(CollabEditOps.Parse(Encoding.UTF8.GetBytes(body)), actor, Now);

      written.Add(new JsonObject
      {
        ["name"] = name,
        ["actor"] = actor,
        ["nowMs"] = Now,
        ["body"] = body,
        ["canonical"] = Encoding.UTF8.GetString(CollabEditOps.CanonicalBody(ops)),
      });
    }

    return new JsonObject
    {
      ["$comment"] = "CollabStampAuthority.Apply on a parsed /edit body, as C# answers it, written as the canonical body. Captured by CollabAttributionCaptureTests; do not edit by hand.",
      ["cases"] = written,
    };
  }
}
