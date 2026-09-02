namespace Blok.Server.Yjs;

internal enum UpdateVerdict
{
  Ok,
  Malformed,
  TooDeep,
}

internal sealed record UpdateInspection(
    UpdateVerdict Verdict,
    string? Reason,
    DecodedUpdate? Decoded);

/// <summary>
/// The screen a room puts in front of an incoming update. It decodes once and
/// hands the result back, so the document does not decode again.
///
/// A NUL is reported through <see cref="DecodedUpdate.ContainsNul"/>, never
/// as a verdict: the sender's state vector already covers a NUL-bearing
/// update, so refusing it would only make every following SyncStep2 resend it.
/// </summary>
internal static class UpdateInspector
{
  public static UpdateInspection Inspect(ReadOnlySpan<byte> update, int maxDepth = 256)
  {
    DecodedUpdate decoded;

    try
    {
      decoded = UpdateV1Decoder.Decode(update);
    }
    catch (FormatException refused)
    {
      // Lib0FormatException derives from FormatException; catching the base
      // also covers anything the codec raises without wrapping.
      return new UpdateInspection(UpdateVerdict.Malformed, refused.Message, null);
    }

    if (decoded.MaxNestingDepth > maxDepth)
    {
      return new UpdateInspection(
          UpdateVerdict.TooDeep,
          $"yjs: a value nests {decoded.MaxNestingDepth} levels, past the {maxDepth} allowed.",
          null);
    }

    return new UpdateInspection(UpdateVerdict.Ok, null, decoded);
  }
}
