using System.Text.Json.Nodes;

namespace Blok.Server.Collab;

/// <summary>
/// The server's own block stamps on an /edit, when the host turns on
/// <c>CollabStampAuthority</c>. Runs after the request digest, so a retry
/// still matches its receipt. A restore never passes here and keeps the
/// stamps it brings back.
/// </summary>
internal static class CollabStampAuthority
{
  private static readonly string[] StampKeys =
      ["createdAt", "createdBy", "createdWith", "lastEditedAt", "lastEditedBy", "lastEditedWith"];

  /// <summary>
  /// An insert's six stamps are replaced: both times are <paramref name="nowMs"/>,
  /// By and With follow <see cref="CollabActorKinds.Attribution"/>, and an
  /// unknown one is removed. An update is followed by a stamp of its block,
  /// unless no actor is known. Every other op is kept as it is.
  /// </summary>
  internal static IReadOnlyList<CollabEditOp> Apply(IReadOnlyList<CollabEditOp> ops, string? actorId, double nowMs)
  {
    var (by, with) = CollabActorKinds.Attribution(actorId, CollabActorKinds.Classify(actorId));
    var stamped = new List<CollabEditOp>(ops.Count);

    foreach (var op in ops)
    {
      switch (op)
      {
        case CollabEditOp.Insert insert:
          var block = (JsonObject)insert.Block.DeepClone();

          foreach (var key in StampKeys)
          {
            block.Remove(key);
          }

          block["createdAt"] = nowMs;
          block["lastEditedAt"] = nowMs;

          if (by is not null)
          {
            block["createdBy"] = by;
            block["lastEditedBy"] = by;
          }

          if (with is not null)
          {
            block["createdWith"] = with;
            block["lastEditedWith"] = with;
          }

          stamped.Add(insert with { Block = block });

          break;

        case CollabEditOp.Update update:
          stamped.Add(update);

          if (by is not null)
          {
            stamped.Add(new CollabEditOp.SetMetadata(update.Id, nowMs, by, with));
          }

          break;

        default:
          stamped.Add(op);

          break;
      }
    }

    return stamped;
  }
}
