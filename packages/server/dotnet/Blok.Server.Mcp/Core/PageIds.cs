using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Blok.Server.Mcp.Core;

internal static class PageIds
{
  // src/shared/mint-id.ts's alphabet, so ids look the same.
  private const string Alphabet = "57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9";

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
    return string.Concat(RandomNumberGenerator.GetBytes(10).Select(b => Alphabet[b & 63]));
  }
}
