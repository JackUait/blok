using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/sync-wire-decode.json, which
/// the Go wire tests read too: frames, awareness payloads and messages, each
/// with what SyncWire answers. C# is the reference, so every answer is
/// recomputed here; run with BLOK_WRITE_FIXTURES=1 to rewrite them after a
/// deliberate change.
/// </summary>
public sealed class SyncWireDecodeFixtureTests
{
  private static string Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(bytes);

  private static string Text(ulong value) => value.ToString(CultureInfo.InvariantCulture);

  private static JsonObject Fields(SyncWireMessage message)
  {
    return message switch
    {
      SyncStep1Frame step1 => new JsonObject { ["stateVectorHex"] = Hex(step1.StateVector) },
      SyncStep2Frame step2 => new JsonObject { ["updateHex"] = Hex(step2.Update) },
      SyncUpdateFrame update => new JsonObject { ["updateHex"] = Hex(update.Update) },
      AwarenessFrame awareness => new JsonObject { ["updateHex"] = Hex(awareness.Update) },
      PermissionDeniedFrame denied => new JsonObject { ["reason"] = denied.Reason },
      BlokControlFrame control => new JsonObject
      {
        ["epoch"] = control.Tag.Epoch.ToString(CultureInfo.InvariantCulture),
        ["format"] = control.Tag.Format,
        ["lineage"] = control.Tag.Lineage,
      },
      BlokLimitsFrame limits => new JsonObject
      {
        ["maxMessageBytes"] = limits.MaxMessageBytes.ToString(CultureInfo.InvariantCulture),
      },
      OperationFrame operation => new JsonObject
      {
        ["lineage"] = operation.Lineage,
        ["operationId"] = operation.OperationId,
        ["updateHex"] = Hex(operation.Update),
      },
      AcknowledgementFrame acknowledgement => new JsonObject
      {
        ["lineage"] = acknowledgement.Lineage,
        ["operationId"] = acknowledgement.OperationId,
        ["serverSequence"] = Text(acknowledgement.ServerSequence),
      },
      RejectionFrame rejection => new JsonObject
      {
        ["lineage"] = rejection.Lineage,
        ["operationId"] = rejection.OperationId,
        ["code"] = rejection.Code,
      },
      IdentitiesFrame identities => new JsonObject
      {
        ["identities"] = new JsonArray([.. identities.Identities.Select(identity => (JsonNode)new JsonObject
        {
          ["clientId"] = Text(identity.ClientId),
          ["actorId"] = identity.ActorId,
        })]),
      },
      UnknownFrame unknown => new JsonObject { ["messageType"] = Text(unknown.MessageType) },
      _ => [],
    };
  }

  private static JsonNode EncodeAnswer(Func<byte[]> encode)
  {
    try
    {
      return Hex(encode());
    }
    catch (Exception error)
    {
      return new JsonObject { ["throws"] = error.GetType().Name };
    }
  }

  private static JsonObject Decode(byte[] frame)
  {
    var answer = new JsonObject();

    try
    {
      var ok = SyncWire.TryDecode(frame, out var message, out var error, out var rule);
      answer["ok"] = ok;

      if (ok)
      {
        answer["kind"] = message!.GetType().Name;
        answer["fields"] = Fields(message);
        answer["reencoded"] = EncodeAnswer(() => SyncWire.Encode(message));
      }
      else
      {
        answer["error"] = error;
        answer["rule"] = rule;
      }
    }
    catch (Exception error)
    {
      answer["throws"] = error.GetType().Name;
    }

    return answer;
  }

  private static JsonObject Awareness(byte[] payload, int maxClients)
  {
    var entries = new List<AwarenessEntry>();
    var valid = SyncWire.TryValidateAwarenessUpdate(payload, maxClients, out var clientCount, entries);

    return new JsonObject
    {
      ["valid"] = valid,
      ["clientCount"] = clientCount,
      ["entries"] = new JsonArray([.. entries.Select(entry => (JsonNode)new JsonObject
      {
        ["clientId"] = Text(entry.ClientId),
        ["clock"] = Text(entry.Clock),
        ["removed"] = entry.Removed,
      })]),
    };
  }

  private static string Field(JsonObject message, string name) => message[name]!.GetValue<string>();

  private static ulong Unsigned(JsonObject message, string name) =>
      ulong.Parse(Field(message, name), CultureInfo.InvariantCulture);

  private static SyncWireMessage Message(JsonObject message)
  {
    return Field(message, "kind") switch
    {
      "SyncStep1Frame" => new SyncStep1Frame(Convert.FromHexString(Field(message, "stateVectorHex"))),
      "SyncStep2Frame" => new SyncStep2Frame(Convert.FromHexString(Field(message, "updateHex"))),
      "SyncUpdateFrame" => new SyncUpdateFrame(Convert.FromHexString(Field(message, "updateHex"))),
      "AwarenessFrame" => new AwarenessFrame(Convert.FromHexString(Field(message, "updateHex"))),
      "QueryAwarenessFrame" => new QueryAwarenessFrame(),
      "ActivityFrame" => new ActivityFrame(),
      "PermissionDeniedFrame" => new PermissionDeniedFrame(Field(message, "reason")),
      "BlokControlFrame" => new BlokControlFrame(new CollabWorkingSetTag(
          message["format"]!.GetValue<int>(),
          long.Parse(Field(message, "epoch"), CultureInfo.InvariantCulture),
          Field(message, "lineage"))),
      "BlokLimitsFrame" => new BlokLimitsFrame(long.Parse(Field(message, "maxMessageBytes"), CultureInfo.InvariantCulture)),
      "OperationFrame" => new OperationFrame(
          Field(message, "lineage"),
          Field(message, "operationId"),
          Convert.FromHexString(Field(message, "updateHex"))),
      "AcknowledgementFrame" => new AcknowledgementFrame(
          Field(message, "lineage"),
          Field(message, "operationId"),
          Unsigned(message, "serverSequence")),
      "RejectionFrame" => new RejectionFrame(
          Field(message, "lineage"),
          Field(message, "operationId"),
          Field(message, "code")),
      "IdentitiesFrame" => new IdentitiesFrame([.. message["identities"]!.AsArray().Select(node =>
          new AwarenessIdentity(Unsigned(node!.AsObject(), "clientId"), Field(node!.AsObject(), "actorId")))]),
      var kind => throw new InvalidDataException($"unknown kind {kind}"),
    };
  }

  private static void Check(JsonObject entry, JsonNode answer, bool write)
  {
    if (write)
    {
      entry["answer"] = answer;

      return;
    }

    Assert.Equal(entry["answer"]?.ToJsonString(), answer.ToJsonString());
  }

  [Fact]
  public void WireAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/sync-wire-decode.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var write = Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1";

    foreach (var entry in fixture["decode"]!.AsArray().Select(node => node!.AsObject()))
    {
      Check(entry, Decode(Convert.FromHexString(Field(entry, "frameHex"))), write);
    }

    foreach (var entry in fixture["awareness"]!.AsArray().Select(node => node!.AsObject()))
    {
      Check(
          entry,
          Awareness(Convert.FromHexString(Field(entry, "payloadHex")), entry["maxClients"]!.GetValue<int>()),
          write);
    }

    foreach (var entry in fixture["removal"]!.AsArray().Select(node => node!.AsObject()))
    {
      var clients = entry["entries"]!.AsArray()
          .Select(node => new AwarenessEntry(
              Unsigned(node!.AsObject(), "clientId"),
              Unsigned(node!.AsObject(), "clock"),
              Removed: true))
          .ToList();
      Check(entry, Hex(SyncWire.EncodeAwarenessRemoval(clients)), write);
    }

    foreach (var entry in fixture["encode"]!.AsArray().Select(node => node!.AsObject()))
    {
      Check(entry, EncodeAnswer(() => SyncWire.Encode(Message(entry["message"]!.AsObject()))), write);
    }

    if (write)
    {
      File.WriteAllText(
          path,
          fixture.ToJsonString(new JsonSerializerOptions
          {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
          }) + "\n");
    }
  }
}
