using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Sources;
using Blok.Server.Runtime;

namespace Blok.Server.Mcp.Tests;

/// <summary>A files source whose next save or load can be made to throw once.</summary>
internal sealed class FaultySource(IDocumentSource real) : IDocumentSource
{
  internal Exception? NextSave { get; set; }

  internal Exception? NextLoad { get; set; }

  /// <summary>Thrown by the next save after it stored the text, as a timeout after the write.</summary>
  internal Exception? NextSaveAfterWrite { get; set; }

  internal int Saves { get; private set; }

  public string DocumentTextForm => real.DocumentTextForm;

  public bool CanList => real.CanList;

  public Task<LoadedDocument> LoadAsync(string documentId, CancellationToken cancellationToken)
  {
    if (NextLoad is { } error)
    {
      NextLoad = null;
      throw error;
    }

    return real.LoadAsync(documentId, cancellationToken);
  }

  public Task<string?> SaveAsync(string documentId, string text, string? ifVersion, CancellationToken cancellationToken)
  {
    Saves++;
    if (NextSave is { } error)
    {
      NextSave = null;
      throw error;
    }

    if (NextSaveAfterWrite is { } late)
    {
      NextSaveAfterWrite = null;
      return SaveThenThrowAsync(documentId, text, ifVersion, late, cancellationToken);
    }

    return real.SaveAsync(documentId, text, ifVersion, cancellationToken);
  }

  private async Task<string?> SaveThenThrowAsync(string documentId, string text, string? ifVersion, Exception error, CancellationToken cancellationToken)
  {
    await real.SaveAsync(documentId, text, ifVersion, cancellationToken);
    throw error;
  }

  public Task<JsonObject> ListAsync(int limit, string? query, string? cursor, CancellationToken cancellationToken)
  {
    return real.ListAsync(limit, query, cursor, cancellationToken);
  }
}

/// <summary>The real engine, except an operation can be made to throw, or agentExecute to lose its documentText.</summary>
internal sealed class FaultyRuntime(IBlokRuntime real) : IBlokRuntime
{
  internal Func<string, string, bool>? Throws { get; set; }

  internal bool DropDocumentText { get; set; }

  public async ValueTask<string> InvokeAsync(string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
  {
    if (Throws?.Invoke(operation, inputJson) == true)
    {
      throw new InvalidOperationException($"{operation} failed");
    }
    var output = await real.InvokeAsync(operation, inputJson, timeout, cancellationToken);

    if (DropDocumentText && operation == "agentExecute" && JsonNode.Parse(output) is JsonObject ran)
    {
      ran.Remove("documentText");

      return ran.ToJsonString();
    }

    return output;
  }
}

internal static class StoredFaults
{
  internal static readonly McpCaller Caller = new(
      "alice", "desk", null, new JsonObject { ["id"] = "agent:alice:desk", ["name"] = "desk", ["kind"] = "agent" }, "desk");

  internal static JsonObject Batch(params JsonObject[] commands) => new() { ["commands"] = new JsonArray(commands) };

  internal static JsonObject Command(string name, JsonObject args) => new() { ["name"] = name, ["args"] = args };

  internal static JsonObject SetTitle(string title) => Command("doc.setTitle", new JsonObject { ["title"] = title });

  internal static JsonObject InsertPage(string id) => Command("block.insert", new JsonObject { ["type"] = "page", ["id"] = id });

  /// <summary>A page-map pages port whose create runs <paramref name="create"/>.</summary>
  internal static PagePorts Pages(Func<McpCaller, CancellationToken, Task<string>> create) => new()
  {
    Create = create,
    Open = (_, _, _) => throw new InvalidOperationException("No page target."),
    TrackClose = _ => { },
  };

  internal static Task<StoredSession> OpenAsync(McpBundle bundle, IDocumentSource source, PagePorts? pages = null)
  {
    var flags = new McpConfig { PageTitles = pages is null ? null : "page-map", Source = new McpSourceConfig.Files(".") }.SurfaceFlags();

    return StoredSession.OpenAsync(bundle, source, "doc", true, flags, (JsonObject)Caller.Actor.DeepClone(), string.Empty, pages, null, CancellationToken.None);
  }

  internal static JsonObject? Answer(McpExecuteOutcome outcome) => outcome.Answer?["structuredContent"] as JsonObject;
}
