using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The /edit request parser, its canonical body and digest, and the
/// idempotency key mapping, captured from C# into
/// fixtures/canonical-edit-digest.json. The digest is stored in the journal,
/// so a Go server that canonicalised one byte differently would answer 409
/// to an honest retry of a request C# committed. The Go twin is
/// internal/collab/convert/editops_test.go. Set BLOK_WRITE_EDIT_DIGEST=1 to
/// rewrite the file after an intended change.
/// </summary>
public sealed class CanonicalEditDigestCaptureTests
{
  private const string FileName = "canonical-edit-digest.json";

  [Fact]
  public void TheCaptureMatchesTheParser()
  {
    var built = Build().ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
    var path = RichTextFixtures.PathOf(FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_EDIT_DIGEST") == "1")
    {
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_EDIT_DIGEST=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private static JsonObject Build()
  {
    return new JsonObject
    {
      ["$comment"] = "Captured from C# by CanonicalEditDigestCaptureTests. Do not edit by hand. A body is UTF-8 text, or bodyHex when it is not UTF-8.",
      ["parse"] = Parses(),
      ["agent"] = AgentOps(),
      ["keys"] = Keys(),
      ["restore"] = Restores(),
      ["doubles"] = Doubles(),
    };
  }

  private static JsonArray Parses()
  {
    var cases = new JsonArray();

    void Add(string name, byte[] body, bool text = true)
    {
      var entry = new JsonObject { ["name"] = name };

      if (text)
      {
        entry["body"] = Encoding.UTF8.GetString(body);
      }
      else
      {
        entry["bodyHex"] = Convert.ToHexStringLower(body);
      }

      try
      {
        var ops = CollabEditOps.Parse(body);
        entry["canonical"] = Encoding.UTF8.GetString(CollabEditOps.CanonicalBody(ops));
        entry["digestHex"] = Convert.ToHexStringLower(CollabEditOps.CanonicalBodyDigest(ops));
      }
      catch (CollabEditException refusal)
      {
        entry["error"] = refusal.Message;
      }

      cases.Add(entry);
    }

    // "~u" stands for a JSON \u escape, so the source holds no escape a tool could decode.
    void Text(string name, string body) => Add(name, Encoding.UTF8.GetBytes(body.Replace("~u", "\\u", StringComparison.Ordinal)));
    void Op(string name, string op) => Text(name, $$"""{ "ops": [{ "op": "remove", "id": "ok" }, {{op}}] }""");

    // Accepted, and what the digest must ignore or keep.
    Text("three ops in order", """{ "ops": [ { "op": "insert", "id": "b1", "block": { "type": "paragraph", "data": { "text": "hi" } }, "after": "b0", "parent": "p1" }, { "op": "update", "id": "b2", "data": { "text": "bye" } }, { "op": "remove", "id": "b3" } ] }""");
    Text("insert with no place", """{"ops":[{"op":"insert","id":"b1","block":{"type":"p","data":{}}}]}""");
    Text("insert with null place", """{"ops":[{"op":"insert","id":"b1","block":{"type":"p","data":{}},"after":null,"parent":null}]}""");
    Text("block members the converter writes", """{ "ops": [{ "op": "insert", "id": "b1", "block": { "id": "b1", "type": "paragraph", "data": { "text": "hi" }, "tunes": { "align": "left" }, "lastEditedAt": 17, "lastEditedBy": "u1", "lastEditedWith": "agent", "createdAt": 1.5, "createdBy": "u2", "createdWith": "w" } }] }""");
    Text("keys in any order", """{"ops":[{"block":{"data":{"text":"!","z":"ignored"},"type":"p"},"id":"new","op":"insert"}]}""");
    Text("keys in the other order", """{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "z": "ignored", "text": "!" } } } ] }""");
    Text("escaping the writer does", """{"ops":[{"op":"update","id":"b","data":{"a":"é<>&'+~u0041\/\"\\\b\f\n\r\t~u001f~u007f~u2028 ","b":"`"}}]}""");
    Text("raw and escaped non-ASCII", """{"ops":[{"op":"update","id":"é","data":{"x":"~u00e9","y":"é","z":"😀","w":"~ud83d~ude00"}}]}""");
    Text("keys sort by UTF-16 units", """{"ops":[{"op":"update","id":"b","data":{"｡":2,"😀":3,"a":1,"B":0,"ab":4,"":5}}]}""");
    Text("numbers keep their text", """{"ops":[{"op":"update","id":"b","data":{"a":1.0,"b":1e2,"c":12345678901234567890123,"d":-0,"e":1E+2,"f":0.10,"g":-1.5e-7}}]}""");
    Text("literals and nesting", """{"ops":[{"op":"update","id":"b","data":{"t":true,"f":false,"n":null,"a":[1,[2,{"z":1,"y":[]}],{}],"o":{}}}]}""");
    Text("whitespace everywhere", " \t\r\n{ \"ops\" :\n[ { \"op\" : \"remove\" , \"id\" : \"b\" } ] }\n ");
    Text("unknown root members are ignored", """{"ops":[{"op":"remove","id":"b"}],"extra":{"x":1}}""");
    Text("a NUL in an unknown root member", """{"ops":[{"op":"remove","id":"b"}],"extra":"a~u0000b"}""");
    Text("tunes null", """{"ops":[{"op":"insert","id":"b1","block":{"type":"p","data":{},"tunes":null}}]}""");
    Text("lastEditedAt null", """{"ops":[{"op":"insert","id":"b1","block":{"type":"p","data":{},"lastEditedAt":null}}]}""");
    Text("lastEditedBy null", """{"ops":[{"op":"insert","id":"b1","block":{"type":"p","data":{},"lastEditedBy":null}}]}""");
    Text("op id with a surrogate pair", """{"ops":[{"op":"remove","id":"~ud83d~ude00"}]}""");
    Add("BOM before the body", [0xef, 0xbb, 0xbf, .. "{\"ops\":[{\"op\":\"remove\",\"id\":\"b\"}]}"u8]);
    Text("depth at the limit", """{"ops":[{"op":"update","id":"b","data":{"a":""" + new string('[', 508) + new string(']', 508) + "}}]}");
    Text("depth past the limit", """{"ops":[{"op":"update","id":"b","data":{"a":""" + new string('[', 509) + new string(']', 509) + "}}]}");

    // The envelope.
    Text("not JSON", "not json at all");
    Text("empty body", "");
    Text("duplicate member", """{ "ops": [{ "op": "remove", "id": "a", "id": "b" }] }""");
    Text("duplicate deep member", """{ "ops": [{ "op": "update", "id": "a", "data": { "k": { "x": 1, "x": 2 } } }] }""");
    Text("duplicate ops", """{ "ops": [{ "op": "remove", "id": "a" }], "ops": [] }""");
    Text("array root", "[]");
    Text("null root", "null");
    Text("ops object", """{ "ops": {} }""");
    Text("ops empty", """{ "ops": [] }""");
    Text("ops missing", """{ "op": [] }""");
    Text("trailing comma", """{ "ops": [{ "op": "remove", "id": "a" },] }""");
    Text("trailing text", """{ "ops": [{ "op": "remove", "id": "a" }] } x""");
    Text("comment", """{ "ops": [{ "op": "remove", "id": "a" }] } // x""");
    Text("single quotes", """{ 'ops': [] }""");
    Text("raw control character", "{\"ops\":[{\"op\":\"remove\",\"id\":\"a\tb\"}]}");

    // Every schema refusal names the failing op.
    Op("unknown op", """{ "op": "move", "id": "b1" }""");
    Op("op not a string", """{ "op": 7, "id": "b1" }""");
    Op("op missing", """{ "id": "b1" }""");
    Op("op an array", """["remove", "b1"]""");
    Op("op null", "null");
    Op("remove without id", """{ "op": "remove" }""");
    Op("empty id", """{ "op": "remove", "id": "" }""");
    Op("id a number", """{ "op": "remove", "id": 7 }""");
    Op("remove with data", """{ "op": "remove", "id": "b1", "data": {} }""");
    Op("insert without block", """{ "op": "insert", "id": "b1" }""");
    Op("block an array", """{ "op": "insert", "id": "b1", "block": [] }""");
    Op("block without type", """{ "op": "insert", "id": "b1", "block": { "data": {} } }""");
    Op("block empty type", """{ "op": "insert", "id": "b1", "block": { "type": "", "data": {} } }""");
    Op("block without data", """{ "op": "insert", "id": "b1", "block": { "type": "p" } }""");
    Op("block data an array", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": [] } }""");
    Op("block id disagrees", """{ "op": "insert", "id": "b1", "block": { "id": "x", "type": "p", "data": {} } }""");
    Op("block parent", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "parent": "p" } }""");
    Op("block content", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "content": [] } }""");
    Op("block extra", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "extra": 1 } }""");
    Op("after a number", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} }, "after": 7 }""");
    Op("parent empty", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {} }, "parent": "" }""");
    Op("update without data", """{ "op": "update", "id": "b1" }""");
    Op("update data a string", """{ "op": "update", "id": "b1", "data": "text" }""");
    Op("update data null", """{ "op": "update", "id": "b1", "data": null }""");
    Op("tunes a string", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "tunes": "x" } }""");
    Op("lastEditedAt a string", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "lastEditedAt": "1" } }""");
    Op("createdAt a string", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "createdAt": "1" } }""");
    Op("lastEditedBy a number", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "lastEditedBy": 1 } }""");
    Op("createdBy empty", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "createdBy": "" } }""");
    Op("createdWith a number", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "createdWith": 1 } }""");
    Op("lastEditedWith a number", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": {}, "lastEditedWith": 1 } }""");
    Op("block id a number", """{ "op": "insert", "id": "b1", "block": { "id": 1, "type": "p", "data": {} } }""");
    Op("member order: unknown before missing id", """{ "op": "insert", "x": 1, "block": { "type": "p", "data": {} } }""");
    Op("patchMaps from the wire", """{ "op": "patchMaps", "patches": [{ "map": "page", "key": "title", "value": "x" }] }""");
    Op("op name case", """{ "op": "Remove", "id": "b1" }""");

    // NUL anywhere.
    Op("NUL in an id", """{ "op": "remove", "id": "b~u00001" }""");
    Op("NUL in a block type", """{ "op": "insert", "id": "b1", "block": { "type": "p~u0000p", "data": {} } }""");
    Op("NUL in a data key", """{ "op": "update", "id": "b1", "data": { "k~u0000": 1 } }""");
    Op("NUL deep in data", """{ "op": "insert", "id": "b1", "block": { "type": "p", "data": { "rows": [{ "cell": "a~u0000b" }] } } }""");
    Op("NUL in an unknown member", """{ "op": "remove", "id": "b1", "x~u0000": 1 }""");
    Op("NUL before the op name is read", """{ "op": "fly~u0000", "id": "b1" }""");

    // Text .NET cannot read as a string.
    Text("lone high surrogate in an id", """{"ops":[{"op":"remove","id":"~ud800"}]}""");
    Text("lone low surrogate in a value", """{"ops":[{"op":"update","id":"b","data":{"t":"~udc00"}}]}""");
    Text("lone surrogate in a key", """{"ops":[{"op":"update","id":"b","data":{"~ud800":1}}]}""");
    Text("lone surrogate in a root key", """{"~ud800":1,"ops":[{"op":"remove","id":"b"}]}""");
    Text("reversed pair", """{"ops":[{"op":"remove","id":"~ude00~ud83d"}]}""");
    Add("raw 0xff in a key", [.. "{\"ops\":[{\"op\":\"update\",\"id\":\"b\",\"data\":{\""u8, 0xff, .. "\":1}}]}"u8], text: false);
    Add("raw 0xff in a value", [.. "{\"ops\":[{\"op\":\"update\",\"id\":\"b\",\"data\":{\"t\":\""u8, 0xff, .. "\"}}]}"u8], text: false);
    Add("encoded surrogate in a value", [.. "{\"ops\":[{\"op\":\"remove\",\"id\":\""u8, 0xed, 0xa0, 0x80, .. "\"}]}"u8], text: false);
    Add("overlong slash in a value", [.. "{\"ops\":[{\"op\":\"remove\",\"id\":\""u8, 0xc0, 0xaf, .. "\"}]}"u8], text: false);
    Add("a NUL key before a bad key", [.. "{\"ops\":[{\"op\":\"update\",\"id\":\"b\",\"data\":{\"k\\u0000\":1,\""u8, 0xff, .. "\":2}}]}"u8], text: false);
    Add("a NUL value before a bad key", [.. "{\"ops\":[{\"op\":\"update\",\"id\":\"b\",\"data\":{\"k\":\"\\u0000\",\""u8, 0xff, .. "\":2}}]}"u8], text: false);
    Add("a NUL value before a bad value", [.. "{\"ops\":[{\"op\":\"update\",\"id\":\"b\",\"data\":{\"k\":\"\\u0000\",\"j\":\""u8, 0xff, .. "\"}}]}"u8], text: false);
    Add("a bad key in an earlier op than a NUL", [.. "{\"ops\":[{\"op\":\"remove\",\"id\":\"\\u0000\"},{\"op\":\"update\",\"id\":\"b\",\"data\":{\""u8, 0xff, .. "\":2}}]}"u8], text: false);
    Add("a bad root key", [.. "{\""u8, 0xff, .. "\":1,\"ops\":[{\"op\":\"remove\",\"id\":\"b\"}]}"u8], text: false);
    Add("truncated sequence in an unknown root member", [.. "{\"ops\":[{\"op\":\"remove\",\"id\":\"b\"}],\"x\":\""u8, 0xe2, 0x82, .. "\"}"u8], text: false);

    return cases;
  }

  private static JsonArray AgentOps()
  {
    var ops = new (string Name, CollabEditOp Op)[]
    {
      ("move", new CollabEditOp.Move("b1", "b0", "p1")),
      ("move to the start of the root", new CollabEditOp.Move("b1", null, null)),
      ("lift", new CollabEditOp.Lift("b1")),
      ("retype", new CollabEditOp.Retype("b1", "header", new JsonObject { ["z"] = 1, ["a"] = "é", ["level"] = 2.5 })),
      ("setTunes", new CollabEditOp.SetTunes("b1", new JsonObject { ["align"] = "left", ["anchor"] = null })),
      ("setMetadata", new CollabEditOp.SetMetadata("b1", 1730000000000, "user-1")),
      ("setMetadata with", new CollabEditOp.SetMetadata("b1", 0.1 + 0.2, "u<1>", "agent")),
      ("setMetadata large", new CollabEditOp.SetMetadata("b1", 1e21, "u", null)),
      ("setMetadata small", new CollabEditOp.SetMetadata("b1", 1e-7, "u", null)),
      ("setMetadata negative zero", new CollabEditOp.SetMetadata("b1", -0.0, "u", null)),
      ("setMetadata max", new CollabEditOp.SetMetadata("b1", double.MaxValue, "u", null)),
      ("setPageField", new CollabEditOp.SetPageField("title", JsonValue.Create("Hi"))),
      ("setPageField null", new CollabEditOp.SetPageField("icon", null)),
      ("setPageField object", new CollabEditOp.SetPageField("icon", new JsonObject { ["value"] = "x", ["type"] = "emoji" })),
    };
    var cases = new JsonArray();

    foreach (var (name, op) in ops)
    {
      var canonical = CollabEditOps.CanonicalBody([op]);
      cases.Add(new JsonObject
      {
        ["name"] = name,
        ["lastEditedAtBits"] = op is CollabEditOp.SetMetadata metadata
            ? BitConverter.DoubleToInt64Bits(metadata.LastEditedAt).ToString(CultureInfo.InvariantCulture)
            : null,
        ["canonical"] = Encoding.UTF8.GetString(canonical),
        ["digestHex"] = Convert.ToHexStringLower(SHA256.HashData(canonical)),
      });
    }

    return cases;
  }

  private static JsonArray Keys()
  {
    var keys = new JsonArray();

    foreach (var key in new[]
    {
      "edit-key", "a", " ", "~", "a b", new string('k', 128), new string('k', 129), "", "\u001f", "\u007f", "é", "tab\there", "\"quoted\"",
    })
    {
      keys.Add(new JsonObject
      {
        ["key"] = key,
        ["operationId"] = CollabEditOps.TryNormalizeIdempotencyKey(key, out var id) ? id : null,
      });
    }

    return keys;
  }

  /// <summary>
  /// How .NET writes a double: Utf8JsonWriter.WriteNumber (the setMetadata
  /// digest) and ToString(InvariantCulture) (a numeric doc-endpoint version).
  /// Go's strconv differs in the exponent (1e+21 against 1E+21).
  /// </summary>
  private static JsonArray Doubles()
  {
    var doubles = new JsonArray();
    var values = new[]
    {
      0.0, -0.0, 1, -1, 0.1, 0.1 + 0.2, 1.5, 100, 1e14, 123456789012345, 1e15, 1234567890123456, 1e16, 1e20, 1e21,
      1.5e300, double.MaxValue, double.Epsilon, 2.2250738585072014e-308, 1e-4, 1.5e-4, 1e-5, 1.2345e-5, 1e-7, 123.456,
      9007199254740991, 9007199254740993, 1e17, 1.5e16, 12345678901234567, 123456789012345678, 1e18, 1e19, 0.00012345678901234567, 4.35, 0.000123, 1730000000000, 1.7e308, 5e-324, 1e100, 999999999999999.9, 0.30000000000000004,
    };

    foreach (var value in values)
    {
      using var buffer = new MemoryStream();

      using (var writer = new Utf8JsonWriter(buffer))
      {
        writer.WriteNumberValue(value);
      }

      doubles.Add(new JsonObject
      {
        ["bits"] = BitConverter.DoubleToInt64Bits(value).ToString(CultureInfo.InvariantCulture),
        ["json"] = Encoding.UTF8.GetString(buffer.ToArray()),
        ["invariant"] = value.ToString(CultureInfo.InvariantCulture),
      });
    }

    return doubles;
  }

  /// <summary>The restore digest, as CollabRoomManager.RestoreAsync computes it from the request line.</summary>
  private static JsonArray Restores()
  {
    var restores = new JsonArray();

    foreach (var (lineage, sequence) in new (string, ulong)[]
    {
      ("0123456789abcdef0123456789abcdef", 1),
      ("fedcba9876543210fedcba9876543210", ulong.MaxValue),
      ("0123456789abcdef0123456789abcdef", 0),
    })
    {
      restores.Add(new JsonObject
      {
        ["lineage"] = lineage,
        ["sequence"] = sequence.ToString(CultureInfo.InvariantCulture),
        ["digestHex"] = Convert.ToHexStringLower(CollabRoomManager.RestoreDigest(lineage, sequence)),
      });
    }

    return restores;
  }
}
