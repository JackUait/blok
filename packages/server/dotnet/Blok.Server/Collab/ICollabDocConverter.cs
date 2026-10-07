using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>
/// The room's view of the OutputData ⇄ Doc conversion. Kept behind an
/// interface so the room is tested against a tiny fake while
/// <see cref="YDocConverter"/> carries the real lockstep laws.
///
/// Asynchronous because a rich text field may hold HTML, and reading HTML
/// runs the embedded runtime. Every write happens after the last await, so a
/// refusal still leaves the doc untouched.
/// </summary>
internal interface ICollabDocConverter
{
  /// <summary>
  /// Writes <paramref name="outputData"/> (a bare OutputData object) into the
  /// doc in ONE write transaction — the room observes that commit as the
  /// seed update. Throws on a malformed document; the room then fails the
  /// seed closed.
  /// </summary>
  ValueTask SeedAsync(YDoc doc, JsonNode outputData, CancellationToken cancellationToken = default);

  /// <summary>
  /// Reads the doc back as a bare OutputData object. The doc is read before
  /// the first await.
  /// </summary>
  ValueTask<JsonNode> ExportAsync(YDoc doc, CancellationToken cancellationToken = default);

  /// <summary>
  /// Applies block-level edit ops in ONE write transaction, validating every
  /// op against the doc FIRST — a refusal (<see cref="CollabEditException"/>)
  /// leaves the doc untouched.
  /// </summary>
  ValueTask ApplyOpsAsync(
      YDoc doc, IReadOnlyList<CollabEditOp> ops, CancellationToken cancellationToken = default);

  /// <summary>
  /// Room format 1 → 2: every rich field still holding HTML becomes formatted
  /// text, in ONE local transaction (none when nothing is left). The doc is
  /// read before the first await and written after the last, so a failure
  /// leaves it untouched. Returns how many fields were replaced.
  /// </summary>
  ValueTask<int> MigrateRichTextAsync(YDoc doc, CancellationToken cancellationToken = default);
}

/// <summary>
/// A conversion that failed for a reason a retry may heal — the embedded
/// runtime timed out, ran out of its allocation budget, or waited too long
/// for a free engine. Not a document the converter can never read: the room
/// backs off and retries instead of giving up on the projection.
/// </summary>
internal sealed class CollabTransientException(string message, Exception? inner = null)
    : Exception(message, inner);
