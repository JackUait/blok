using System.Text.Json.Nodes;

namespace Blok.Server.Mcp.Core;

internal static class PageIds
{
  /*
   * How many page documents to make for agentPagesNeeded's answer. A batch that would be
   * refused, or that waits on a person, makes none: Node plans it whole first. Only a batch
   * refused after its pages were prepared made them in Node; the bundle lists those as orphans.
   */
  internal static int ToMake(JsonObject needed)
  {
    if (needed["result"] is not JsonObject refused)
    {
      return (int)(McpJson.Number(needed["count"]) ?? 0);
    }
    var error = refused["error"];

    return McpJson.String(error?["code"]) != "ORPHANED_SIDE_EFFECT"
        ? 0
        : (error?["details"]?["orphaned"] as JsonArray ?? [])
            .Count(orphan => McpJson.String(orphan?["prepared"]?["pageId"])?.StartsWith("planned-page-", StringComparison.Ordinal) == true);
  }

  internal static string Mint()
  {
    return Blok.Server.Agent.BlokPageIds.Mint();
  }

  // blok_open's documentId maxLength, which JSON Schema counts in code points.
  private const int MaxPageId = 512;

  /// <summary>
  /// A host's page id: 1-512 code points, well-formed UTF-16 (no lone surrogate), no Unicode Cc
  /// character, and not "." or "..", which name a directory in every source.
  /// </summary>
  internal static bool IsHostPageId(string id)
  {
    if (id is "" or "." or "..")
    {
      return false;
    }
    var codePoints = 0;

    for (var index = 0; index < id.Length; index++)
    {
      var unit = id[index];

      if (char.IsHighSurrogate(unit))
      {
        if (index + 1 >= id.Length || !char.IsLowSurrogate(id[index + 1]))
        {
          return false;
        }
        index++;
      }
      else if (char.IsLowSurrogate(unit) || char.IsControl(unit))
      {
        return false;
      }
      codePoints++;
    }

    return codePoints <= MaxPageId;
  }
}
