using System.Text.Json.Nodes;

namespace Blok.Server.Mcp.Core;

/// <summary>
/// The host side of the bundle's upload replay. Jint cannot wait on the host mid-batch, so
/// agentExecute stops at each upload call; the host runs it and sends the batch again with one
/// more answer, in call order (server-runtime.ts replayUploader).
/// </summary>
internal sealed class UploadPorts(BlokMcpUploads uploads, Action<string, Exception>? log = null)
{
  internal async Task<JsonObject> ExecuteAsync(McpBundle bundle, JsonObject input, CancellationToken cancellationToken)
  {
    var answers = new JsonArray();
    var settings = new JsonObject { ["root"] = false, ["byUrl"] = uploads.Uploader.UploadByUrl is not null, ["limits"] = Limits() };

    while (true)
    {
      settings["answers"] = answers.DeepClone();
      input["uploads"] = settings.DeepClone();
      var ran = await bundle.CallAsync("agentExecute", input, cancellationToken);

      if (ran["upload"] is not JsonObject call)
      {
        return ran;
      }
      answers.Add(await RunAsync(call, cancellationToken));
    }
  }

  /// <summary>
  /// Runs one upload call. Only the bytes the bundle handed back for this call go up, and only
  /// at the size its checks saw. A host's throw is an answer: the bundle fails that command with it.
  /// </summary>
  internal async Task<JsonObject> RunAsync(JsonObject call, CancellationToken cancellationToken)
  {
    var context = new BlokMcpUploadContext(McpJson.String(call["kind"]) ?? string.Empty, McpJson.String(call["tool"]) ?? string.Empty);

    try
    {
      switch (McpJson.String(call["op"]))
      {
        case "uploadByFile":
          if (McpJson.String(call["data"]) is not { } data)
          {
            return Thrown("This host reads no local files.");
          }
          var bytes = new byte[data.Length];

          if (!Convert.TryFromBase64String(data, bytes, out var length))
          {
            return Thrown("blok-mcp: the upload's data is not base64.");
          }
          var size = McpJson.Number(call["size"]);

          if (size != length)
          {
            return Thrown($"blok-mcp: the upload is {length} bytes, not the {size} the batch checked.");
          }
          var file = new BlokMcpUploadFile(bytes.AsMemory(0, length), McpJson.String(call["fileName"]) ?? string.Empty, McpJson.String(call["type"]) ?? string.Empty);

          return Asset(await uploads.Uploader.UploadByFile(file, context, cancellationToken));
        case "uploadByUrl":
          return uploads.Uploader.UploadByUrl is { } byUrl
              ? Asset(await byUrl(new Uri(McpJson.String(call["url"]) ?? string.Empty, UriKind.RelativeOrAbsolute), context, cancellationToken))
              : Thrown("This host copies no linked files.");
        case "readLocal":
          return Thrown("This host reads no local files.");
        default:
          return Thrown($"blok-mcp: unknown upload call \"{McpJson.String(call["op"])}\".");
      }
    }
    catch (Exception error) when (error is not OperationCanceledException)
    {
      // The agent sees the message, as Node's prepareAt forwards it; the host gets all of it.
      (log ?? LogToStderr)("blok-mcp: the host uploader failed", error);

      return Thrown(error.Message);
    }
  }

  private static void LogToStderr(string message, Exception error)
  {
    Console.Error.WriteLine($"{message}: {error}");
  }

  private static JsonObject Thrown(string message) => new() { ["error"] = message };

  private static JsonObject Asset(BlokMcpUploadedFile stored)
  {
    var answer = new JsonObject { ["url"] = stored.Url.OriginalString };

    if (stored.FileName is not null)
    {
      answer["fileName"] = stored.FileName;
    }
    if (stored.Size is long size)
    {
      answer["size"] = size;
    }
    if (stored.MimeType is not null)
    {
      answer["mimeType"] = stored.MimeType;
    }

    return answer;
  }

  private JsonObject Limits()
  {
    var limits = new JsonObject();

    foreach (var (kind, limit) in uploads.Limits ?? new Dictionary<string, BlokMcpUploadLimits>())
    {
      var entry = new JsonObject();

      if (limit.Types is not null)
      {
        entry["types"] = new JsonArray([.. limit.Types.Select(type => (JsonNode)type)]);
      }
      if (limit.MaxSize is long max)
      {
        entry["maxSize"] = max;
      }
      limits[kind] = entry;
    }

    return limits;
  }
}
