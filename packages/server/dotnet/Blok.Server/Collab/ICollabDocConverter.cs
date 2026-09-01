using System.Text.Json.Nodes;
using YDotNet.Document;

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
  void Seed(Doc doc, JsonNode outputData);

  /// <summary>Reads the doc back as a bare OutputData object.</summary>
  JsonNode Export(Doc doc);

  /// <summary>
  /// Validates every op against the doc's current state, then applies them
  /// all in ONE write transaction — the room observes that commit as one
  /// local update. Throws <see cref="CollabEditException"/> (naming the op
  /// index) BEFORE anything is written when any op is invalid.
  /// </summary>
  void ApplyOps(Doc doc, IReadOnlyList<CollabEditOp> ops);
}
