using System.Text;

namespace Blok.Server.Mcp.Core;

/// <summary>JS's encodeURIComponent and URLSearchParams, byte for byte.</summary>
internal static class JsUri
{
  private const string ComponentSafe = "-_.!~*'()";
  private const string FormSafe = "*-._";

  internal static string EncodeComponent(string value)
  {
    return Encode(value, ComponentSafe, spaceAsPlus: false);
  }

  internal static string FormEncode(IEnumerable<KeyValuePair<string, string>> pairs)
  {
    return string.Join('&', pairs.Select(pair =>
        $"{Encode(pair.Key, FormSafe, spaceAsPlus: true)}={Encode(pair.Value, FormSafe, spaceAsPlus: true)}"));
  }

  private static string Encode(string value, string safe, bool spaceAsPlus)
  {
    var builder = new StringBuilder();
    // A lone surrogate becomes U+FFFD, as URLSearchParams does; encodeURIComponent throws there.
    var bytes = Encoding.UTF8.GetBytes(value);

    foreach (var b in bytes)
    {
      var c = (char)b;

      if (b < 0x80 && (char.IsAsciiLetterOrDigit(c) || safe.Contains(c, StringComparison.Ordinal)))
      {
        builder.Append(c);
      }
      else if (spaceAsPlus && c == ' ')
      {
        builder.Append('+');
      }
      else
      {
        builder.Append('%').Append(b.ToString("X2", System.Globalization.CultureInfo.InvariantCulture));
      }
    }

    return builder.ToString();
  }
}
