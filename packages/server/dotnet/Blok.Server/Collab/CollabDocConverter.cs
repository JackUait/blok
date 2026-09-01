using System.Text.Json.Nodes;
using YDotNet.Document;

namespace Blok.Server.Collab;

/// <summary>
/// Binds <see cref="YDocConverter"/> (the lockstep block ⇄ Doc laws) to the
/// room's <see cref="ICollabDocConverter"/>: unwraps the OutputData object
/// on the way in and rebuilds one (time + blocks) on the way out.
/// </summary>
internal sealed class CollabDocConverter(TimeProvider timeProvider) : ICollabDocConverter
{
  public void Seed(Doc doc, JsonNode outputData)
  {
    ArgumentNullException.ThrowIfNull(outputData);

    if (outputData is not JsonObject document)
    {
      throw new InvalidDataException("collab: the document is not a JSON object.");
    }

    if (document["blocks"] is not JsonArray blocks)
    {
      throw new InvalidDataException("collab: the document has no blocks array.");
    }

    YDocConverter.Seed(doc, blocks);
  }

  public JsonNode Export(Doc doc)
  {
    return new JsonObject
    {
      ["time"] = timeProvider.GetUtcNow().ToUnixTimeMilliseconds(),
      ["blocks"] = YDocConverter.Export(doc),
    };
  }

  public void ApplyOps(Doc doc, IReadOnlyList<CollabEditOp> ops)
  {
    YDocConverter.ApplyOps(doc, ops);
  }
}
