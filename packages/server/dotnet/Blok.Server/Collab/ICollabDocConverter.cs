using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>
/// The room's view of the OutputData ⇄ Doc conversion. Kept behind an
/// interface so the room is tested against a tiny fake while
/// <see cref="YDocConverter"/> carries the real lockstep laws.
/// </summary>
internal interface ICollabDocConverter
{
  /// <summary>
  /// Writes <paramref name="outputData"/> (a bare OutputData object) into the
  /// doc in ONE write transaction — the room observes that commit as the
  /// seed update. Throws on a malformed document; the room then fails the
  /// seed closed.
  /// </summary>
  void Seed(YDoc doc, JsonNode outputData);

  /// <summary>Reads the doc back as a bare OutputData object.</summary>
  JsonNode Export(YDoc doc);

  /// <summary>
  /// Applies block-level edit ops in ONE write transaction, validating every
  /// op against the doc FIRST — a refusal (<see cref="CollabEditException"/>)
  /// leaves the doc untouched.
  /// </summary>
  void ApplyOps(YDoc doc, IReadOnlyList<CollabEditOp> ops);
}
