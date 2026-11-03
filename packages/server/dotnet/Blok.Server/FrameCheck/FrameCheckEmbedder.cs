namespace Blok.Server.FrameCheck;

/// <summary>
/// Picks the origin GET /frame-check rates a page for. Go's
/// framecheck.Embedder is the twin; frame-check-embedders.json pins both.
/// </summary>
internal static class FrameCheckEmbedder
{
  /// <summary>
  /// A sent Origin decides alone. Without one, the embedder query value counts
  /// when the browser says the request is same-origin and the value is this
  /// server's own origin, or when it is an allowed origin. Never trust the
  /// value alone: any page could then learn framing policies for any site.
  /// </summary>
  /// <param name="origin">The Origin header, or null when none was sent.</param>
  /// <param name="secFetchSite">The Sec-Fetch-Site header, or "".</param>
  /// <param name="embedder">The embedder query value, or "".</param>
  /// <param name="self">scheme://Host of the request, or "" with no Host.</param>
  /// <param name="isAllowed">The CORS allowed-origins check.</param>
  /// <returns>The embedder origin, or null for none.</returns>
  internal static string? Choose(
      string? origin,
      string secFetchSite,
      string embedder,
      string self,
      Func<string, bool> isAllowed)
  {
    if (origin is not null)
    {
      return isAllowed(origin) ? origin : null;
    }

    // Pages cannot set Sec-Fetch-Site, so a browser page reaches this only
    // from the server's own origin.
    if (self.Length > 0 &&
        string.Equals(secFetchSite, "same-origin", StringComparison.OrdinalIgnoreCase) &&
        string.Equals(embedder, self, StringComparison.OrdinalIgnoreCase))
    {
      return embedder;
    }

    return isAllowed(embedder) ? embedder : null;
  }
}
