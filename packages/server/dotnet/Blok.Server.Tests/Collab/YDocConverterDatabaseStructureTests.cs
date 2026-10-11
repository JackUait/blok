using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A button property's <c>buttonActions</c> is born empty and two peers grow
/// it, so it is an ordered id-array key: stored as a <see cref="YArray"/> from
/// birth, even on a server-seeded database.
///
/// LOCKSTEP: <c>EAGER_ARRAY_KEYS</c> in src/components/modules/yjs/serializer.ts,
/// and test/unit/tools/database/concurrent-database-structure.test.ts.
/// </summary>
public sealed class YDocConverterDatabaseStructureTests
{
  private const string DatabaseWithButton =
      """
      { "id": "db", "type": "database",
        "data": { "activeViewId": "v", "views": [],
          "schema": [{ "id": "btn", "name": "Act", "type": "button", "position": "a0", "button": { "buttonActions": [] } }] } }
      """;

  [Fact]
  public void TwoPeersAddingTheFirstActionAtOnceKeepBoth()
  {
    var server = SeededDoc(DatabaseWithButton);
    var peer = Peer(server);

    Apply(server, """{ "op": "update", "id": "db", "data": { "schema": [{ "id": "btn", "name": "Act", "type": "button", "position": "a0", "button": { "buttonActions": [{ "id": "x1", "type": "openPage" }] } }] } }""");
    Apply(peer, """{ "op": "update", "id": "db", "data": { "schema": [{ "id": "btn", "name": "Act", "type": "button", "position": "a0", "button": { "buttonActions": [{ "id": "x2", "type": "callback" }] } }] } }""");
    Exchange(server, peer);

    Assert.Equal(["x1", "x2"], ActionIds(server));
    Assert.Equal(["x1", "x2"], ActionIds(peer));
  }

  [Fact]
  public void TwoPeersAddingTheFirstSavedAutomationDefinitionAtOnceKeepBoth()
  {
    var server = AutomationDoc("[]");
    var peer = Peer(server);

    ApplyAutomations(server, $$"""{ "version": 1, "definitions": [{{AutomationDefinition("auto-a", "First")}}] }""");
    ApplyAutomations(peer, $$"""{ "version": 1, "definitions": [{{AutomationDefinition("auto-b", "Second")}}] }""");
    Exchange(server, peer);

    Assert.Equal(["auto-a", "auto-b"], AutomationIds(server, "definitions"));
    Assert.Equal(["auto-a", "auto-b"], AutomationIds(peer, "definitions"));
    foreach (var doc in new[] { server, peer })
    {
      Assert.True(JsonNode.DeepEquals(JsonNode.Parse(AutomationDefinition("auto-a", "First")), AutomationEntry(doc, "auto-a")));
      Assert.True(JsonNode.DeepEquals(JsonNode.Parse(AutomationDefinition("auto-b", "Second")), AutomationEntry(doc, "auto-b")));
    }
  }

  [Fact]
  public void TwoPeersAddingTheFirstTriggerToOneSavedDefinitionAtOnceKeepBoth()
  {
    var definition = AutomationDefinition("auto-1", "Draft");
    var server = AutomationDoc($"[{definition}]");
    var peer = Peer(server);
    var first = Assert.IsType<JsonObject>(JsonNode.Parse(definition));
    var second = Assert.IsType<JsonObject>(JsonNode.Parse(definition));

    first["triggers"] = JsonNode.Parse("""[{ "id": "trigger-a", "type": "pageAdded" }]""");
    second["triggers"] = JsonNode.Parse("""[{ "id": "trigger-b", "type": "propertyEdited", "propertyId": "p-sum" }]""");
    ApplyAutomations(server, $$"""{ "version": 1, "definitions": [{{first.ToJsonString()}}] }""");
    ApplyAutomations(peer, $$"""{ "version": 1, "definitions": [{{second.ToJsonString()}}] }""");
    Exchange(server, peer);

    Assert.Equal(["trigger-a", "trigger-b"], AutomationIds(server, "triggers"));
    Assert.Equal(["trigger-a", "trigger-b"], AutomationIds(peer, "triggers"));
    foreach (var doc in new[] { server, peer })
    {
      Assert.Equal(["auto-1"], AutomationIds(doc, "definitions"));
      var triggers = Assert.IsType<JsonArray>(AutomationEntry(doc, "auto-1")?["triggers"]);

      Assert.True(JsonNode.DeepEquals(first["triggers"]?[0], triggers.First(item => item?["id"]?.GetValue<string>() == "trigger-a")));
      Assert.True(JsonNode.DeepEquals(second["triggers"]?[0], triggers.First(item => item?["id"]?.GetValue<string>() == "trigger-b")));
    }
  }

  [Fact]
  public void TwoPeersAddingTheFirstActionToOneSavedDefinitionAtOnceKeepBoth()
  {
    var definition = AutomationDefinition("auto-1", "Draft");
    var server = AutomationDoc($"[{definition}]");
    var peer = Peer(server);
    var first = Assert.IsType<JsonObject>(JsonNode.Parse(definition));
    var second = Assert.IsType<JsonObject>(JsonNode.Parse(definition));

    first["actions"] = JsonNode.Parse("""[{ "id": "action-a", "type": "editProperty", "target": "triggerRow", "propertyId": "p-sum", "value": "first" }]""");
    second["actions"] = JsonNode.Parse("""[{ "id": "action-b", "type": "editProperty", "target": "triggerRow", "propertyId": "p-title", "value": "second" }]""");
    ApplyAutomations(server, $$"""{ "version": 1, "definitions": [{{first.ToJsonString()}}] }""");
    ApplyAutomations(peer, $$"""{ "version": 1, "definitions": [{{second.ToJsonString()}}] }""");
    Exchange(server, peer);

    Assert.Equal(["action-a", "action-b"], AutomationIds(server, "actions"));
    Assert.Equal(["action-a", "action-b"], AutomationIds(peer, "actions"));
    foreach (var doc in new[] { server, peer })
    {
      Assert.Equal(["auto-1"], AutomationIds(doc, "definitions"));
      var actions = Assert.IsType<JsonArray>(AutomationEntry(doc, "auto-1")?["actions"]);

      Assert.True(JsonNode.DeepEquals(first["actions"]?[0], actions.First(item => item?["id"]?.GetValue<string>() == "action-a")));
      Assert.True(JsonNode.DeepEquals(second["actions"]?[0], actions.First(item => item?["id"]?.GetValue<string>() == "action-b")));
    }
  }

  private static string AutomationDefinition(string id, string name)
  {
    return $$"""
      { "id": "{{id}}", "name": "{{name}}", "status": "paused",
        "scope": { "type": "database" }, "triggerMode": "any", "triggers": [], "actions": [] }
      """;
  }

  private static YDoc AutomationDoc(string definitions)
  {
    return SeededDoc($$"""
      { "id": "db1", "type": "database", "data": {
        "title": "Intake",
        "schema": [
          { "id": "p-title", "name": "Name", "type": "title", "position": "a0" },
          { "id": "p-where", "name": "Where", "type": "place", "position": "a1" },
          { "id": "p-check", "name": "Verified", "type": "verification", "position": "a2" },
          { "id": "p-sum", "name": "Summary", "type": "text", "position": "a3" }
        ],
        "views": [{
          "id": "v1", "name": "Form", "type": "form", "position": "a0",
          "sorts": [], "filters": [], "visibleProperties": [],
          "properties": [
            { "id": "p-title", "visible": true }, { "id": "p-where", "visible": true },
            { "id": "p-check", "visible": true }, { "id": "p-sum", "visible": true }
          ],
          "form": {}
        }],
        "activeViewId": "v1",
        "automations": { "version": 1, "definitions": {{definitions}} }
      } }
      """);
  }

  private static void ApplyAutomations(YDoc doc, string automations)
  {
    var block = YDocConverter.Export(doc).AsArray().First(node => node?["id"]?.GetValue<string>() == "db1");
    var data = Assert.IsType<JsonObject>(block?["data"]).DeepClone().AsObject();

    data["automations"] = JsonNode.Parse(automations);
    Apply(doc, new JsonObject { ["op"] = "update", ["id"] = "db1", ["data"] = data }.ToJsonString());
  }

  private static string[] AutomationIds(YDoc doc, string list)
  {
    var block = YDocConverter.Export(doc).AsArray().First(node => node?["id"]?.GetValue<string>() == "db1");
    var definitions = Assert.IsType<JsonArray>(block?["data"]?["automations"]?["definitions"]);
    var entries = list == "definitions" ? definitions : Assert.IsType<JsonArray>(definitions[0]?[list]);

    return entries.Select(item => item?["id"]?.GetValue<string>() ?? "").OrderBy(id => id, StringComparer.Ordinal).ToArray();
  }

  private static JsonNode? AutomationEntry(YDoc doc, string id)
  {
    var block = YDocConverter.Export(doc).AsArray().First(node => node?["id"]?.GetValue<string>() == "db1");
    var definitions = Assert.IsType<JsonArray>(block?["data"]?["automations"]?["definitions"]);

    return definitions.First(node => node?["id"]?.GetValue<string>() == id);
  }

  private static string[] ActionIds(YDoc doc)
  {
    var block = YDocConverter.Export(doc).AsArray().First(node => node?["id"]?.GetValue<string>() == "db");
    var actions = block?["data"]?["schema"]?[0]?["button"]?["buttonActions"]?.AsArray() ?? [];

    return actions.Select(item => item?["id"]?.GetValue<string>() ?? "").OrderBy(id => id, StringComparer.Ordinal).ToArray();
  }

  private static YDoc Peer(YDoc server)
  {
    var peer = new YDoc();

    Assert.Equal(
        ApplyOutcome.Applied,
        peer.ApplyUpdate(server.EncodeStateAsUpdate(peer.EncodeStateVector())).Outcome);

    return peer;
  }

  private static void Exchange(YDoc left, YDoc right)
  {
    var toRight = left.EncodeStateAsUpdate(right.EncodeStateVector());
    var toLeft = right.EncodeStateAsUpdate(left.EncodeStateVector());

    Assert.Equal(ApplyOutcome.Applied, right.ApplyUpdate(toRight).Outcome);
    Assert.Equal(ApplyOutcome.Applied, left.ApplyUpdate(toLeft).Outcome);
  }

  private static YDoc SeededDoc(params string[] blockJson)
  {
    var doc = new YDoc();

    YDocConverter.Seed(doc, new JsonArray(blockJson.Select(json => JsonNode.Parse(json)).ToArray()));

    return doc;
  }

  private static void Apply(YDoc doc, params string[] opJson)
  {
    YDocConverter.ApplyOps(
        doc,
        CollabEditOps.Parse(
            Encoding.UTF8.GetBytes($$"""{ "ops": [{{string.Join(",", opJson)}}] }""")));
  }
}
