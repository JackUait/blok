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

      var name = McpJson.String(command["name"]);

      switch (name)
      {
        case "history.versions":
        case "history.restore":
          loaded ??= [];
          // A restore lists the versions too: the newest one is what it pins.
          if (loaded["versions"] is null)
          {
            var group = name == "history.versions" && args["group"] is JsonValue value && value.TryGetValue<double>(out var minutes) ? minutes.ToString(System.Globalization.CultureInfo.InvariantCulture) : null;
            var listed = await GetAsync(group is null ? historyBase : $"{historyBase}?group={group}", cancellationToken);

            if (listed.Failed is not null)
            {
              return listed.Failed;
            }
            loaded["versions"] = VersionsOf(listed.Body);
          }
          if (name == "history.versions")
          {
            continue;
          }
          versions = [McpJson.String(args["version"]) ?? string.Empty];
          break;
        case "history.read":
          versions = [McpJson.String(args["version"]) ?? string.Empty];
          break;
        case "history.changes":
          versions = [McpJson.String(args["from"]) ?? string.Empty, McpJson.String(args["to"]) ?? string.Empty];
          break;
        case "history.previewRestore":
          loaded ??= [];
          // A preview asks its own route and reads nothing else.
          if (await LoadPreviewAsync(args, loaded, cancellationToken) is { } failed)
          {
            return failed;
          }
          continue;
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

  /// <summary>
  /// Posts the preview route for a history.previewRestore and keeps its answer under
  /// <c>previews</c>, null for a 404. Arguments the bundle refuses ask nothing.
  /// </summary>
  private async Task<JsonObject?> LoadPreviewAsync(JsonObject args, JsonObject loaded, CancellationToken cancellationToken)
  {
    var previews = loaded["previews"] as JsonObject ?? [];

    loaded["previews"] = previews;
    if (McpJson.String(args["version"]) is not { Length: > 0 } version)
    {
      return null;
    }
    var query = string.Empty;

    if (args.ContainsKey("databases"))
    {
      var databases = McpJson.String(args["databases"]);

      if (databases is not ("keep" or "restore"))
      {
        return null;
      }
      query = $"?databases={databases}";
    }
    if (PointPath(version) is not { } path)
    {
      previews[version] = null;
      return null;
    }
    var preview = await GetAsync($"{historyBase}/{path}/restore/preview{query}", cancellationToken, notFoundIsNull: true, method: "POST");

    if (preview.Failed is not null)
    {
      return preview.Failed;
    }
    // As Node's: the bundle refuses a body that is no preview, so it is passed on as it came.
    previews[version] = preview.Body;

    return null;
  }

  /// <summary>
  /// Posts the restore the bundle checked, as the history drawer does: null when it landed,
  /// else the error Node's runRestore answers. <paramref name="previous"/> pins the newest version.
  /// </summary>
  internal async Task<JsonObject?> RestoreAsync(string version, string? previous, CancellationToken cancellationToken)
  {
    if (PointPath(version) is not { } path)
    {
      return NotFound(version);
    }
    // A pin the server cannot read would restore unpinned, so it never leaves here.
    if (previous is not null && PointPath(previous) is null)
    {
      return Stale();
    }
    // One key per restore: a retried request that already landed is answered, never applied twice.
    var headers = new List<KeyValuePair<string, string>> { new("Blok-Idempotency-Key", Guid.NewGuid().ToString()) };

    if (previous is not null)
    {
      headers.Add(new("If-Match", $"\"{previous}\""));
    }
    McpHttpResponse response;

    try
    {
      response = await SendAsync("POST", $"{historyBase}/{path}/restore", headers, false, cancellationToken);
      if (response.Status == 401 && tickets is not null)
      {
        response = await SendAsync("POST", $"{historyBase}/{path}/restore", headers, true, cancellationToken);
      }
    }
    catch (McpUnreachableException)
    {
      return HostFailure($"The sync server could not be reached: {NodeFetchError}", true);
    }
    catch (McpBodyException error)
    {
      return HostFailure($"The sync server could not be reached: {error.Message}", true);
    }
    // Node's ask(): a failed mint is a plain error, named after "The version history failed: ".
    catch (McpHostError error)
    {
      return HostFailure(error.Message, false);
    }

    return response.Status switch
    {
      404 => NotFound(version),
      412 => Stale(),
      < 200 or > 299 => HostFailure(
          $"The sync server answered {response.Status}: {response.Body.Trim()}",
          response.Status != 500 && (response.Status == 429 || (response.Status is >= 500 and <= 599 && response.Status != 501))),
      _ => null,
    };
  }

  // Key order as Node builds them: failure(), then the executor's atCommand.
  private static JsonObject Stale() => new()
  {
    ["code"] = "STALE",
    ["message"] = "The document changed since the version history was read, so nothing was restored. Read it again, then retry.",
    ["commandIndex"] = 0,
    ["retryable"] = true,
  };

  private static JsonObject NotFound(string version) => new()
  {
    ["code"] = "VERSION_NOT_FOUND",
    ["message"] = $"There is no version \"{version}\". history.versions lists them.",
    ["path"] = "/commands/0/args/version",
    ["retryable"] = false,
    ["commandIndex"] = 0,
  };

  private static JsonObject HostFailure(string message, bool retryable) => new()
  {
    ["code"] = "TOOL_ACTION_FAILED",
    ["message"] = $"The version history failed: {message}",
    ["retryable"] = retryable,
    ["commandIndex"] = 0,
    ["path"] = "/commands/0/args",
  };

  private const string NodeFetchError = "fetch failed";

  private async Task<(JsonNode? Body, JsonObject? Failed)> GetAsync(
      string url, CancellationToken cancellationToken, bool notFoundIsNull = false, string method = "GET")
  {
    McpHttpResponse response;

    try
    {
      response = await SendAsync(method, url, [], false, cancellationToken);
      if (response.Status == 401 && tickets is not null)
      {
        response = await SendAsync(method, url, [], true, cancellationToken);
      }
    }
    // No answer at all: the network may come back. "fetch failed" is Node's fetch error.
    catch (McpUnreachableException)
    {
      return (null, new JsonObject { ["failed"] = $"The sync server could not be reached: {NodeFetchError}", ["retryable"] = true });
    }
    catch (McpBodyException error)
    {
      return (null, new JsonObject { ["failed"] = $"The sync server could not be reached: {error.Message}" });
    }
    catch (McpHostError error)
    {
      return (null, new JsonObject { ["failed"] = error.Message });
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

  private async Task<McpHttpResponse> SendAsync(
      string method, string url, IReadOnlyList<KeyValuePair<string, string>> extra, bool fresh, CancellationToken cancellationToken)
  {
    var headers = extra.ToList();

    if (tickets is not null && await tickets(fresh) is { } ticket)
    {
      headers.Add(new("Authorization", $"Bearer {ticket}"));
    }
    if (origin is not null)
    {
      headers.Add(new("Origin", origin));
    }

    return await http.SendAsync(new McpHttpRequest(method, url, headers), Timeout.InfiniteTimeSpan, cancellationToken);
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
