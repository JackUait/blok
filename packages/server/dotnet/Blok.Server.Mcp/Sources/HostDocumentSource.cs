using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Protocol;

namespace Blok.Server.Mcp.Sources;

/// <summary>
/// The host's IBlokMcpDocumentSource behind Blok's checks and error words, as Node's
/// sources/custom.ts. Each handle binds the caller that opened it (<see cref="ForCaller"/>).
/// </summary>
internal sealed class HostDocumentSource(IBlokMcpDocumentSource host, Action<string, Exception>? log) : IDocumentSource
{
  // Every port answers with these exact words (shared conformance: embed.json).
  private const string FailedLoad = "The host could not load this document. Try again.";
  private const string FailedSave = "The host could not save this document, so nothing was saved. Try again.";
  private const string FailedList = "The host could not list documents. Try again.";

  // The host may have written it: "nothing was saved" would make the agent repeat its batch.
  private const string SavedWithoutVersion = "The host may have saved this document but did not say which version. Read it before you retry.";

  // As the endpoint text: the bundle writes the compact JSON.stringify text the host stores.
  public string DocumentTextForm => "compact";

  public bool CanList => host is IBlokMcpDocumentLister;

  public IDocumentSource ForCaller(McpCaller caller)
  {
    return new Bound(this, CallerOf(caller));
  }

  public Task<LoadedDocument> LoadAsync(string documentId, CancellationToken cancellationToken)
  {
    throw Unbound();
  }

  public Task<string?> SaveAsync(string documentId, string text, string? ifVersion, CancellationToken cancellationToken)
  {
    throw Unbound();
  }

  public Task<JsonObject> ListAsync(int limit, string? query, string? cursor, CancellationToken cancellationToken)
  {
    throw Unbound();
  }

  private static InvalidOperationException Unbound()
  {
    return new InvalidOperationException("blok-mcp: a host document source is used only through ForCaller");
  }

  private static BlokMcpDocumentCaller CallerOf(McpCaller caller)
  {
    var actor = caller.Actor;

    return new BlokMcpDocumentCaller(
        caller.Principal,
        caller.ClientName,
        caller.Scopes,
        new BlokMcpAgentActor(McpJson.String(actor["id"]) ?? string.Empty, McpJson.String(actor["name"]) ?? string.Empty)
        {
          OnBehalfOf = McpJson.String(actor["onBehalfOf"]),
          Color = McpJson.String(actor["color"]),
        });
  }

  // The endpoint source's rule, so every host gets the same ids whatever it does with them.
  private static string CheckedId(string documentId)
  {
    return documentId is "" or "." or ".."
        ? throw McpHostError.Surface("INVALID_ARGS", $"\"{documentId}\" is not a document id.")
        : documentId;
  }

  /// <summary>A host bug or a plain throw: logged in full, the agent gets generic words.</summary>
  private McpHostError HostFailed(string op, string? documentId, Exception what, string message)
  {
    var line = $"blok-mcp: the host document source failed to {op}{(documentId is null ? string.Empty : $" \"{documentId}\"")}";

    if (log is not null)
    {
      log(line, what);
    }
    else
    {
      Console.Error.WriteLine($"{line} {what}");
    }

    return McpHostError.Surface("SOURCE_UNAVAILABLE", message);
  }

  private static string FallbackMessage(BlokMcpSourceErrorKind kind, string failed)
  {
    return kind switch
    {
      BlokMcpSourceErrorKind.Changed => "Someone saved this document since you opened it. Read it again, then retry.",
      BlokMcpSourceErrorKind.Forbidden => "The host does not allow this.",
      BlokMcpSourceErrorKind.InvalidId => "The host does not accept this document id.",
      _ => failed,
    };
  }

  private static string CodeOf(BlokMcpSourceErrorKind kind)
  {
    return kind switch
    {
      BlokMcpSourceErrorKind.Changed => "DOCUMENT_CHANGED",
      BlokMcpSourceErrorKind.Forbidden => "FORBIDDEN",
      BlokMcpSourceErrorKind.InvalidId => "INVALID_ARGS",
      _ => "SOURCE_UNAVAILABLE",
    };
  }

  private async Task<T> GuardedAsync<T>(string op, string? documentId, string failed, Func<ValueTask<T>> call, CancellationToken cancellationToken)
  {
    try
    {
      return await call();
    }
    catch (BlokMcpSourceException refused)
    {
      var message = string.IsNullOrWhiteSpace(refused.AgentMessage) ? FallbackMessage(refused.Kind, failed) : refused.AgentMessage;

      throw McpHostError.Surface(CodeOf(refused.Kind), message);
    }
    // A cancel of this call stays a cancel.
    catch (Exception error) when (error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
    {
      throw HostFailed(op, documentId, error, failed);
    }
  }

  /// <summary>
  /// The endpoint source's text path: depth on the text, then JSON.parse's reading (a repeated key
  /// keeps its last value, a lone surrogate is U+FFFD), then the shape. Text, so every port parses alike.
  /// </summary>
  private static JsonNode CheckedDocument(string documentId, string text)
  {
    var where = $"The host's document \"{documentId}\"";

    if (McpDepthClamp.TextNestsDeeperThan(text, McpDepthClamp.MaxJsonDepth))
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", $"{where} nests deeper than {McpDepthClamp.MaxJsonDepth} levels of objects and arrays.");
    }
    JsonNode? parsed;

    try
    {
      parsed = McpJson.Parse(Blok.Server.Runtime.JsonInputNormalizer.Normalize(text, long.MaxValue, static () => { }));
    }
    catch (Exception error) when (error is JsonException or ArgumentException)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", $"{where} is not JSON.");
    }
    if (parsed is not JsonObject document || document["blocks"] is not JsonArray)
    {
      throw McpHostError.Surface("SOURCE_UNAVAILABLE", $"{where} is not a Blok document: expected an object with a \"blocks\" array.");
    }

    return parsed;
  }

  // As JS's String.prototype.toWellFormed: a lone surrogate becomes U+FFFD.
  private static string? WellFormed(string? text)
  {
    if (text is null)
    {
      return null;
    }
    StringBuilder? fixedText = null;

    for (var at = 0; at < text.Length; at++)
    {
      var c = text[at];
      var paired = char.IsHighSurrogate(c) && at + 1 < text.Length && char.IsLowSurrogate(text[at + 1]);

      if (paired)
      {
        fixedText?.Append(c).Append(text[at + 1]);
        at++;
        continue;
      }
      if (char.IsSurrogate(c))
      {
        fixedText ??= new StringBuilder(text, 0, at, text.Length);
        fixedText.Append('�');
        continue;
      }
      fixedText?.Append(c);
    }

    return fixedText?.ToString() ?? text;
  }

  private sealed class Bound(HostDocumentSource source, BlokMcpDocumentCaller caller) : IDocumentSource
  {
    public string DocumentTextForm => source.DocumentTextForm;

    public bool CanList => source.CanList;

    public IDocumentSource ForCaller(McpCaller other)
    {
      return source.ForCaller(other);
    }

    public async Task<LoadedDocument> LoadAsync(string documentId, CancellationToken cancellationToken)
    {
      var id = CheckedId(documentId);
      var answer = await source.GuardedAsync("load", id, FailedLoad, () => source.Host.LoadAsync(caller, id, cancellationToken), cancellationToken);

      if (answer is null)
      {
        return new LoadedDocument(new JsonObject { ["blocks"] = new JsonArray() }, null, Missing: true);
      }
      if (answer.DocumentText is null || string.IsNullOrEmpty(answer.Version))
      {
        throw source.HostFailed("load", id, new InvalidOperationException(
            $"load answered {answer}; expected null, or JSON text with a non-empty version"), FailedLoad);
      }

      return new LoadedDocument(CheckedDocument(id, answer.DocumentText), answer.Version);
    }

    public async Task<string?> SaveAsync(string documentId, string text, string? ifVersion, CancellationToken cancellationToken)
    {
      var id = CheckedId(documentId);
      var version = await source.GuardedAsync("save", id, FailedSave, () => source.Host.SaveAsync(caller, id, text, ifVersion, cancellationToken), cancellationToken);

      return string.IsNullOrEmpty(version)
          ? throw source.HostFailed("save", id, new InvalidOperationException(
              $"save answered {(version is null ? "null" : "\"\"")}; expected a non-empty version"), SavedWithoutVersion)
          : version;
    }

    public async Task<JsonObject> ListAsync(int limit, string? query, string? cursor, CancellationToken cancellationToken)
    {
      var lister = (IBlokMcpDocumentLister)source.Host;
      var request = new BlokMcpListRequest(limit) { Query = query, Cursor = cursor };
      var answer = await source.GuardedAsync("list", null, FailedList, () => lister.ListAsync(caller, request, cancellationToken), cancellationToken);

      if (answer?.Documents is null)
      {
        throw source.HostFailed("list", null, new InvalidOperationException("list answered without documents"), FailedList);
      }
      var documents = new JsonArray();

      foreach (var listed in answer.Documents)
      {
        if (listed?.Id is string id)
        {
          documents.Add(new JsonObject { ["id"] = WellFormed(id), ["title"] = WellFormed(listed.Title) });
        }
      }

      return new JsonObject { ["documents"] = documents, ["nextCursor"] = answer.NextCursor };
    }
  }

  private IBlokMcpDocumentSource Host => host;
}
