namespace Blok.Server.Yjs;

/// <summary>Whether an update reached the document at all.</summary>
internal enum ApplyOutcome
{
  Applied,
  Malformed,
}

/// <summary>
/// What <see cref="YDoc.ApplyUpdate(DecodedUpdate)"/> did.
/// <paramref name="PendingRemains"/> is the document's health signal after the
/// call: structs or deletions the update named but could not be applied yet.
/// </summary>
internal readonly record struct ApplyResult(
    ApplyOutcome Outcome, bool PendingRemains, string? Reason);
