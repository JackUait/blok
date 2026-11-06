using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// The agent's awareness fields (src/mcp/live/presence.ts). Never writes
/// <c>caret</c>. Its Activity minute is its own, apart from the provider's.
/// </summary>
internal sealed class LivePresence
{
  private static readonly string[] Palette = ["#0b6e99", "#c1461f", "#0f7b6c", "#6940a5", "#ad1a72", "#886c1a", "#1f5aa8", "#8f3a1c"];
  private static readonly TimeSpan ActivityInterval = TimeSpan.FromSeconds(60);

  private readonly Action<string, JsonNode?> setField;
  private readonly Func<bool> sendActivity;
  private readonly JsonObject actor;
  private readonly string name;
  private readonly string color;
  private readonly Func<DateTimeOffset> now;
  private DateTimeOffset? lastActivity;

  internal LivePresence(Action<string, JsonNode?> setField, Func<bool> sendActivity, JsonObject actor, string name, Func<DateTimeOffset>? now = null)
  {
    this.setField = setField;
    this.sendActivity = sendActivity;
    this.actor = actor;
    this.name = name;
    this.now = now ?? (() => DateTimeOffset.UtcNow);
    color = IsPresenceColor(McpJson.String(actor["color"])) ? McpJson.String(actor["color"])! : ColorFor(McpJson.String(actor["id"]) ?? string.Empty);
  }

  /// <summary>presenceColorFor(sha256(id) first two bytes, big-endian).</summary>
  internal static string ColorFor(string actorId)
  {
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(actorId));

    return Palette[((hash[0] << 8) | hash[1]) % Palette.Length];
  }

  internal void Announce()
  {
    setField("user", new JsonObject { ["name"] = name, ["color"] = color, ["id"] = actor["id"]?.DeepClone() });
    var agent = new JsonObject { ["via"] = "mcp", ["onBehalfOf"] = (actor["onBehalfOf"] ?? actor["id"])?.DeepClone() };

    setField("agent", agent);
  }

  /// <summary>After a successful batch, read-only ones too.</summary>
  internal void AfterBatch(JsonObject result)
  {
    var changed = result["changed"] as JsonObject;
    var touched = Last(changed?["created"]) ?? Last(changed?["updated"]) ?? Last(changed?["moved"]);
    var time = now();

    setField("activeAt", time.ToUnixTimeMilliseconds());
    if (touched is not null)
    {
      var range = result["lastRange"] as JsonObject;
      var blockId = McpJson.String(range?["blockId"]) ?? touched;
      var cursor = new JsonObject
      {
        ["actorId"] = actor["id"]?.DeepClone(),
        ["name"] = name,
        ["color"] = color,
        ["blockId"] = blockId,
      };

      if (range is not null)
      {
        cursor["field"] = range["field"]?.DeepClone();
        cursor["start"] = range["start"]?.DeepClone();
        cursor["end"] = range["end"]?.DeepClone();
      }
      setField("blockId", blockId);
      setField("agentCursor", cursor);
    }
    // A send on a socket that was not ready does not spend the minute.
    if ((lastActivity is null || time - lastActivity >= ActivityInterval) && sendActivity())
    {
      lastActivity = time;
    }
  }

  internal void Clear()
  {
    setField("agentCursor", null);
    setField("blockId", null);
  }

  private static string? Last(JsonNode? ids)
  {
    return ids is JsonArray { Count: > 0 } list ? McpJson.String(list[^1]) : null;
  }

  private static bool IsPresenceColor(string? value)
  {
    return value is not null && System.Text.RegularExpressions.Regex.IsMatch(value, "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$");
  }
}
