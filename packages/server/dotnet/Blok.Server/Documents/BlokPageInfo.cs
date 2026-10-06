namespace Blok.Server.Documents;

/// <summary>
/// What the host lets the reader see about one page, for a page-aware export.
/// </summary>
/// <remarks>
/// A <c>page</c> block, a <c>page-link</c> block and an inline page reference
/// save only a page id. Without this, an export labels each one "Page". In the
/// map passed to the export, a <c>null</c> value means the page is missing
/// ("Page not found"), and an id left out of the map stays "Page".
/// </remarks>
public sealed record BlokPageInfo
{
  /// <summary>The page title. Empty or <c>null</c> reads as "New page" on a page card and "Page" in an inline reference.</summary>
  public string? Title { get; init; }

  /// <summary>The page icon, or <c>null</c> for the default page glyph.</summary>
  public BlokPageIcon? Icon { get; init; }

  /// <summary>
  /// The reader may not see this page. The export shows "No access", hides
  /// the title and icon, and never links it.
  /// </summary>
  public bool NoAccess { get; init; }
}

/// <summary>A page icon: an emoji, or an image URL.</summary>
public sealed record BlokPageIcon
{
  private BlokPageIcon(bool isImage, string value)
  {
    IsImage = isImage;
    Value = value;
  }

  /// <summary><c>true</c> for an image icon, <c>false</c> for an emoji.</summary>
  public bool IsImage { get; }

  /// <summary>The emoji, or the image URL.</summary>
  public string Value { get; }

  /// <summary>An emoji icon.</summary>
  /// <param name="emoji">The emoji.</param>
  public static BlokPageIcon Emoji(string emoji)
  {
    ArgumentNullException.ThrowIfNull(emoji);

    return new BlokPageIcon(isImage: false, emoji);
  }

  /// <summary>
  /// An image icon. The URL passes the same unsafe-scheme check as every
  /// other URL in the export.
  /// </summary>
  /// <param name="url">The image URL.</param>
  public static BlokPageIcon Image(string url)
  {
    ArgumentNullException.ThrowIfNull(url);

    return new BlokPageIcon(isImage: true, url);
  }
}
