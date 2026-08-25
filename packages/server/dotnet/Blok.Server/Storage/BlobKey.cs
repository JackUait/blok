using System.Security.Cryptography;

namespace Blok.Server.Storage;

internal static class BlobKey
{
  private const int RandomByteCount = 16;
  private const int HexLength = RandomByteCount * 2;
  private const int MaximumExtensionLength = 15;

  internal static string Create(string extension)
  {
    Span<byte> random = stackalloc byte[RandomByteCount];
    RandomNumberGenerator.Fill(random);

    return Convert.ToHexStringLower(random) + NormalizeExtension(extension);
  }

  internal static bool TryParsePublicUrl(
      string publicUrl,
      string rawUrl,
      out string key)
  {
    var suffixStart = rawUrl.IndexOfAny(['?', '#']);
    var trimmedUrl = suffixStart < 0 ? rawUrl : rawUrl[..suffixStart];
    var prefix = publicUrl.TrimEnd('/') + "/";

    if (!trimmedUrl.StartsWith(prefix, StringComparison.Ordinal))
    {
      key = "";
      return false;
    }

    key = trimmedUrl[prefix.Length..];

    return IsGenerated(key);
  }

  internal static string NormalizeExtension(string extension)
  {
    if (extension.Length is < 2 or > MaximumExtensionLength + 1 ||
        extension[0] != '.')
    {
      return "";
    }

    foreach (var character in extension.AsSpan(1))
    {
      if (!IsAsciiAlphaNumeric(character))
      {
        return "";
      }
    }

    return extension.ToLowerInvariant();
  }

  internal static bool IsGenerated(string key)
  {
    if (key.Length < HexLength)
    {
      return false;
    }

    foreach (var character in key.AsSpan(0, HexLength))
    {
      if (character is not (>= '0' and <= '9') and
          not (>= 'a' and <= 'f'))
      {
        return false;
      }
    }

    var extension = key[HexLength..];

    return extension == "" || extension == NormalizeExtension(extension);
  }

  private static bool IsAsciiAlphaNumeric(char character)
  {
    return character is (>= 'a' and <= 'z') or
        (>= 'A' and <= 'Z') or
        (>= '0' and <= '9');
  }
}
