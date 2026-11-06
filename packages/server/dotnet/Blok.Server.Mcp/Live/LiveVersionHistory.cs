using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// The room's version history routes (src/mcp/live/version-history.ts), read
/// before a batch and handed to the bundle as its preloaded versionHistory.
/// Each request takes a ticket; a 401 is retried once with a fresh one.
/// </summary>
internal sealed partial class LiveVersionHistory(McpHttpCaller http, string roomUrl, string? origin, RoomTicketSource? tickets)
{
  private readonly string historyBase = $"{WsScheme().Replace(roomUrl, "http$1:")}/history";

  /// <summary>The versionHistory input for a batch's history commands, or null when it has none.</summary>
  internal async Task<JsonObject?> LoadAsync(JsonNode? batch, CancellationToken cancellationToken)
  {
    var commands = (batch as JsonObject)?["commands"] as JsonArray ?? [];
    JsonObject? loaded = null;

    foreach (var command in commands.OfType<JsonObject>())
    {
      var args = command["args"] as JsonObject ?? [];
      List<string> versions;

      switch (McpJson.String(command["name"]))
      {
        case "history.versions":
          loaded ??= [];
          if (loaded["versions"] is null)
          {
            var group = args["group"] is JsonValue value && value.TryGetValue<double>(out var minutes) ? minutes.ToString(System.Globalization.CultureInfo.InvariantCulture) : null;
            var listed = await GetAsync(group is null ? historyBase : $"{historyBase}?group={group}", cancellationToken);

            if (listed.Failed is not null)
            {
              return listed.Failed;
            }
            loaded["versions"] = VersionsOf(listed.Body);
          }
          continue;
        case "history.read":
          versions = [McpJson.String(args["version"]) ?? string.Empty];
          break;
        case "history.changes":
          versions = [McpJson.String(args["from"]) ?? string.Empty, McpJson.String(args["to"]) ?? string.Empty];
          break;
        default:
          continue;
      }
      loaded ??= [];
      var documents = loaded["documents"] as JsonObject ?? [];

      loaded["documents"] = documents;
      foreach (var version in versions.Where(version => !documents.ContainsKey(version)))
      {
        if (PointPath(version) is not { } path)
        {
          documents[version] = null;
          continue;
        }
        var read = await GetAsync($"{historyBase}/{path}", cancellationToken, notFoundIsNull: true);

        if (read.Failed is not null)
        {
          return read.Failed;
        }
        documents[version] = read.Body is JsonObject document && document["blocks"] is JsonArray ? document : null;
      }
    }

    return loaded;
  }

  private async Task<(JsonNode? Body, JsonObject? Failed)> GetAsync(string url, CancellationToken cancellationToken, bool notFoundIsNull = false)
  {
    McpHttpResponse response;

    try
    {
      response = await SendAsync(url, false, cancellationToken);
      if (response.Status == 401 && tickets is not null)
      {
        response = await SendAsync(url, true, cancellationToken);
      }
    }
    catch (Exception error) when (error is McpUnreachableException or McpBodyException)
    {
      return (null, new JsonObject { ["failed"] = $"The sync server could not be reached: {error.Message}" });
    }
    if (notFoundIsNull && response.Status == 404)
    {
      return (null, null);
    }
    if (response.Status is < 200 or > 299)
    {
      return (null, new JsonObject { ["failed"] = $"The sync server answered {response.Status}: {response.Body.Trim()}", ["status"] = response.Status });
    }
    try
    {
      return (McpJson.Parse(response.Body), null);
    }
    catch (JsonException)
    {
      return (null, new JsonObject { ["failed"] = "The sync server sent a version list it could not read." });
    }
  }

  private async Task<McpHttpResponse> SendAsync(string url, bool fresh, CancellationToken cancellationToken)
  {
    var headers = new List<KeyValuePair<string, string>>();

    if (tickets is not null && await tickets(fresh) is { } ticket)
    {
      headers.Add(new("Authorization", $"Bearer {ticket}"));
    }
    if (origin is not null)
    {
      headers.Add(new("Origin", origin));
    }

    return await http.SendAsync(new McpHttpRequest("GET", url, headers), Timeout.InfiniteTimeSpan, cancellationToken);
  }

  private static JsonArray VersionsOf(JsonNode? body)
  {
    if (body is not JsonObject answer || answer["versions"] is not JsonArray versions)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", "The sync server sent a version list it could not read.");
    }
    var current = (answer["lineages"] as JsonArray ?? [])
        .OfType<JsonObject>()
        .Where(lineage => McpJson.Bool(lineage["current"]) == true)
        .Select(lineage => Text(lineage["lineage"]))
        .ToHashSet(StringComparer.Ordinal);

    return new JsonArray([.. versions.OfType<JsonObject>().Select(entry =>
    {
      var version = new JsonObject
      {
        ["version"] = $"{Text(entry["lineage"])}:{Text(entry["sequence"])}",
        ["savedAt"] = entry["savedAt"] is JsonValue saved && saved.TryGetValue<double>(out _) ? saved.DeepClone() : null,
        ["startedAt"] = entry["startedAt"] is JsonValue started && started.TryGetValue<double>(out _) ? started.DeepClone() : null,
        ["actors"] = new JsonArray([.. (entry["actors"] as JsonArray ?? []).OfType<JsonValue>().Where(actor => actor.TryGetValue<string>(out _)).Select(actor => actor.DeepClone())]),
      };

      if (!current.Contains(Text(entry["lineage"])))
      {
        version["beforeReset"] = true;
      }

      return (JsonNode)version;
    })]);
  }

  // String(value) for the values a version entry carries.
  private static string Text(JsonNode? value)
  {
    return value switch
    {
      null => "null",
      JsonValue text when text.TryGetValue<string>(out var s) => s,
      _ => McpJson.Write(value),
    };
  }

  private static string? PointPath(string version)
  {
    var colon = version.LastIndexOf(':');

    if (colon <= 0)
    {
      return null;
    }
    var lineage = version[..colon];
    var sequence = version[(colon + 1)..];

    return lineage is "." or ".." || !Digits().IsMatch(sequence) ? null : $"{JsUri.EncodeComponent(lineage)}/{sequence}";
  }

  [GeneratedRegex("^ws(s?):", RegexOptions.IgnoreCase)]
  private static partial Regex WsScheme();

  [GeneratedRegex("^[0-9]+$")]
  private static partial Regex Digits();
}
