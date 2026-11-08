using System.Text.Json.Nodes;

namespace Blok.Server.Mcp.Core;

/// <summary>
/// Which made pages a failed batch strands (src/mcp/create-page.ts). A page the parent names is
/// no orphan: the host must never be told to delete a page the parent uses.
/// </summary>
internal static class OrphanedPages
{
  /// <summary>
  /// The page ids the parent links: <c>data.pageId</c> of each <c>type: "page"</c> block. Blocks
  /// are one flat list, so nested pages are in it too. Text elsewhere never counts.
  /// </summary>
  internal static HashSet<string> Linked(JsonNode? parent)
  {
    var linked = new HashSet<string>(StringComparer.Ordinal);

    foreach (var block in (parent as JsonObject)?["blocks"] as JsonArray ?? [])
    {
      if (block is JsonObject entry && McpJson.String(entry["type"]) == "page" && McpJson.String(entry["data"]?["pageId"]) is { } pageId)
      {
        linked.Add(pageId);
      }
    }

    return linked;
  }

  /// <summary>
  /// The bundle's ORPHANED_SIDE_EFFECT without the pages the parent names, as Node's
  /// reportOrphanedPages: with none left, the cause is the answer.
  /// </summary>
  internal static void Filter(JsonObject result, JsonNode? parent)
  {
    if (McpJson.Bool(result["ok"]) == true || result["error"] is not JsonObject error || McpJson.String(error["code"]) != "ORPHANED_SIDE_EFFECT"
        || error["details"] is not JsonObject details || details["cause"] is not JsonObject cause || McpJson.String(cause["message"]) is not { } causeMessage)
    {
      return;
    }
    var listed = details["orphaned"] as JsonArray ?? [];
    var linked = Linked(parent);
    var orphaned = listed.Where(receipt => McpJson.String(receipt?["prepared"]?["pageId"]) is not { } pageId || !linked.Contains(pageId)).ToList();

    if (orphaned.Count == listed.Count)
    {
      return;
    }
    if (orphaned.Count == 0)
    {
      result["error"] = cause.DeepClone();

      return;
    }
    error["message"] = $"The batch failed after the host did work for it ({causeMessage}). Clean up the listed items.";
    details["orphaned"] = new JsonArray([.. orphaned.Select(receipt => receipt?.DeepClone())]);
  }

  /// <summary>Whether the batch's page loop stopped on a cancel after it made pages (PagePorts.AddCreatedPagesAsync).</summary>
  internal static bool CancelledAfterPages(JsonObject input)
  {
    return McpJson.String(input["createPageFailure"]?["error"]?["code"]) == "CANCELLED";
  }

  /// <summary>
  /// The bundle keeps a cancel's own code even after pages were made (executor.ts batchFailure),
  /// so a cancel that stopped the page loop names the made pages here, in the bundle's
  /// ORPHANED_SIDE_EFFECT shape: its commandIndex, and the cancel as the cause.
  /// </summary>
  internal static void WrapCancelled(JsonObject result, JsonArray created)
  {
    if (result["error"] is not JsonObject cause || McpJson.String(cause["code"]) != "CANCELLED" || created.Count == 0)
    {
      return;
    }
    var wrapped = new JsonObject
    {
      ["code"] = "ORPHANED_SIDE_EFFECT",
      ["message"] = $"The batch failed after the host did work for it ({McpJson.String(cause["message"])}). Clean up the listed items.",
    };

    if (cause["commandIndex"] is JsonNode commandIndex)
    {
      wrapped["commandIndex"] = commandIndex.DeepClone();
    }
    wrapped["retryable"] = false;
    wrapped["details"] = new JsonObject
    {
      ["orphaned"] = new JsonArray([.. created.Select(pageId => (JsonNode)new JsonObject
      {
        ["command"] = "block.insert", ["type"] = "page", ["prepared"] = new JsonObject { ["pageId"] = pageId?.DeepClone() },
      })]),
      // The cause is the cancel alone; the commandIndex stays on the outer error (Node's shape).
      ["cause"] = new JsonObject { ["code"] = "CANCELLED", ["message"] = cause["message"]?.DeepClone(), ["retryable"] = false },
    };
    result["error"] = wrapped;
  }
}
