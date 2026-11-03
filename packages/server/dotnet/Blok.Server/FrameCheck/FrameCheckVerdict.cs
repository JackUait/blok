using System.Text;
using System.Text.RegularExpressions;

namespace Blok.Server.FrameCheck;

/// <summary>
/// Decides whether a page would let an editor frame it, from the page's final
/// response headers. Follows CSP3 frame-ancestors and the HTML
/// X-Frame-Options processing model, with the editor as the only ancestor.
/// Go's internal/framecheck is the twin; frame-check-verdicts.json pins both.
/// </summary>
internal static partial class FrameCheckVerdict
{
  internal const string Allowed = "allowed";
  internal const string Blocked = "blocked";
  internal const string Insecure = "insecure";
  internal const string Unknown = "unknown";

  /// <summary>
  /// Precedence: blocked, then insecure (the final URL is not https), then
  /// unknown (no embedder), then allowed. Blocked comes first so a refusal
  /// shows even on an http page.
  /// </summary>
  internal static string Evaluate(
      string finalUrl,
      string? embedderOrigin,
      IReadOnlyList<KeyValuePair<string, string>> headers)
  {
    if (ParseOrigin(finalUrl) is not { } self)
    {
      return Unknown;
    }

    var ancestor = embedderOrigin is null ? null : ParseOrigin(embedderOrigin);
    if (ancestor is { } known && IsBlocked(self, known, headers))
    {
      return Blocked;
    }

    if (self.Scheme != "https")
    {
      return Insecure;
    }

    return ancestor is null ? Unknown : Allowed;
  }

  // Port is 0 when it is the scheme's default, like a URL's null port.
  private readonly record struct Origin(
      string Scheme,
      string Host,
      bool Domain,
      int Port);

  private static Origin? ParseOrigin(string raw)
  {
    if (!Uri.TryCreate(raw, UriKind.Absolute, out var url) ||
        (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps) ||
        url.Host == "" ||
        url.UserInfo != "")
    {
      return null;
    }

    var port = url.Port == DefaultPort(url.Scheme) ? 0 : url.Port;
    return new Origin(
        url.Scheme,
        AsciiLower(url.IdnHost),
        url.HostNameType == UriHostNameType.Dns,
        port);
  }

  private static int DefaultPort(string scheme)
  {
    return scheme switch
    {
      "http" or "ws" => 80,
      "https" or "wss" => 443,
      _ => -1,
    };
  }

  private static bool IsBlocked(
      Origin self,
      Origin ancestor,
      IReadOnlyList<KeyValuePair<string, string>> headers)
  {
    var sawFrameAncestors = false;

    // Report-only policies never block, so only enforced ones are read.
    foreach (var (name, value) in headers)
    {
      if (!string.Equals(name, "Content-Security-Policy", StringComparison.OrdinalIgnoreCase))
      {
        continue;
      }

      foreach (var serialized in value.Split(','))
      {
        if (FrameAncestors(serialized) is not { } sources)
        {
          continue;
        }

        sawFrameAncestors = true;
        if (!MatchesSourceList(ancestor, sources, self))
        {
          return true;
        }
      }
    }

    return !sawFrameAncestors && XFrameOptionsBlocks(self, ancestor, headers);
  }

  private static readonly char[] AsciiWhitespace = ['\t', '\n', '\f', '\r', ' '];

  // CSP3 "parse a serialized CSP", keeping only the first frame-ancestors.
  private static string[]? FrameAncestors(string serialized)
  {
    var seen = new HashSet<string>(StringComparer.Ordinal);

    foreach (var raw in serialized.Split(';'))
    {
      var token = raw.Trim(AsciiWhitespace);
      if (token == "" || !Ascii.IsValid(token))
      {
        continue;
      }

      var fields = token.Split(AsciiWhitespace, StringSplitOptions.RemoveEmptyEntries);
      var name = AsciiLower(fields[0]);
      if (!seen.Add(name))
      {
        continue;
      }

      if (name == "frame-ancestors")
      {
        return fields[1..];
      }
    }

    return null;
  }

  private static string AsciiLower(string value)
  {
    var builder = new StringBuilder(value.Length);
    foreach (var c in value)
    {
      builder.Append(c is >= 'A' and <= 'Z' ? (char)(c + ('a' - 'A')) : c);
    }

    return builder.ToString();
  }

  // CSP3 §6.7.2.7 with a redirect count of 0.
  private static bool MatchesSourceList(
      Origin url,
      string[] sources,
      Origin self)
  {
    if (sources.Length == 0 ||
        (sources.Length == 1 &&
         string.Equals(sources[0], "'none'", StringComparison.OrdinalIgnoreCase)))
    {
      return false;
    }

    return sources.Any(expression => MatchesExpression(url, expression, self));
  }

  [GeneratedRegex(@"^([A-Za-z][A-Za-z0-9+.\-]*):\z", RegexOptions.CultureInvariant)]
  private static partial Regex SchemeSource();

  [GeneratedRegex(
      @"^(?:([A-Za-z][A-Za-z0-9+.\-]*)://)?(\*|(?:\*\.)?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.?)(?::([0-9]+|\*))?(/(?:(?:[A-Za-z0-9\-._~!$&'()*+=:@]|%[0-9A-Fa-f]{2})+(?:/(?:[A-Za-z0-9\-._~!$&'()*+=:@]|%[0-9A-Fa-f]{2})*)*)?)?\z",
      RegexOptions.CultureInvariant)]
  private static partial Regex HostSource();

  // CSP3 §6.7.2.8 for an ancestor origin.
  private static bool MatchesExpression(
      Origin url,
      string expression,
      Origin self)
  {
    if (expression == "*")
    {
      return url.Scheme is "http" or "https" || url.Scheme == self.Scheme;
    }

    if (SchemeSource().Match(expression) is { Success: true } scheme)
    {
      return SchemePartMatches(scheme.Groups[1].Value, url.Scheme);
    }

    if (HostSource().Match(expression) is { Success: true } host)
    {
      var schemePart = host.Groups[1].Value;
      if (schemePart != "" && !SchemePartMatches(schemePart, url.Scheme))
      {
        return false;
      }

      if (schemePart == "" && !SchemePartMatches(self.Scheme, url.Scheme))
      {
        return false;
      }

      if (!HostPartMatches(host.Groups[2].Value, url) ||
          !PortPartMatches(host.Groups[3].Value, url))
      {
        return false;
      }

      // An origin's URL path serializes as "/".
      var path = host.Groups[4].Value;
      return path == "" || PathPartMatches(path, "/");
    }

    if (string.Equals(expression, "'self'", StringComparison.OrdinalIgnoreCase))
    {
      return self == url ||
          (self.Host == url.Host &&
           self.Port == url.Port &&
           (url.Scheme == "https" || (self.Scheme == "http" && url.Scheme == "http")));
    }

    return false;
  }

  private static bool SchemePartMatches(string a, string b)
  {
    a = AsciiLower(a);
    b = AsciiLower(b);
    return a == b ||
        (a == "http" && b == "https") ||
        (a == "ws" && b is "wss" or "http" or "https") ||
        (a == "wss" && b == "https");
  }

  private static bool HostPartMatches(string pattern, Origin url)
  {
    if (!url.Domain)
    {
      return false;
    }

    if (pattern == "*")
    {
      return true;
    }

    if (pattern.StartsWith("*.", StringComparison.Ordinal))
    {
      return url.Host.EndsWith(AsciiLower(pattern[1..]), StringComparison.Ordinal);
    }

    return AsciiLower(pattern) == url.Host;
  }

  private static bool PortPartMatches(string input, Origin url)
  {
    if (input == "*")
    {
      return true;
    }

    if (input == "")
    {
      return url.Port == 0;
    }

    var trimmed = input.TrimStart('0');
    if (trimmed.Length > 5)
    {
      return false;
    }

    var want = trimmed == "" ? 0 : int.Parse(trimmed, System.Globalization.CultureInfo.InvariantCulture);
    return want == url.Port || (url.Port == 0 && want == DefaultPort(url.Scheme));
  }

  private static bool PathPartMatches(string a, string b)
  {
    if (a == "" || (a == "/" && b == ""))
    {
      return true;
    }

    var exact = !a.EndsWith('/');
    var listA = a.Split('/');
    var listB = b.Split('/');
    if (listA.Length > listB.Length || (exact && listA.Length != listB.Length))
    {
      return false;
    }

    if (!exact)
    {
      listA = listA[..^1];
    }

    for (var index = 0; index < listA.Length; index++)
    {
      if (Uri.UnescapeDataString(listA[index]) != Uri.UnescapeDataString(listB[index]))
      {
        return false;
      }
    }

    return true;
  }

  // HTML's X-Frame-Options check with one ancestor.
  private static bool XFrameOptionsBlocks(
      Origin self,
      Origin ancestor,
      IReadOnlyList<KeyValuePair<string, string>> headers)
  {
    var lines = headers
        .Where(header => string.Equals(header.Key, "X-Frame-Options", StringComparison.OrdinalIgnoreCase))
        .Select(header => header.Value)
        .ToList();
    if (lines.Count == 0)
    {
      return false;
    }

    var set = new HashSet<string>(StringComparer.Ordinal);
    string? first = null;
    foreach (var value in GetDecodeSplit(string.Join(", ", lines)))
    {
      var lowered = AsciiLower(value);
      first ??= lowered;
      set.Add(lowered);
    }

    if (set.Count > 1)
    {
      return set.Contains("deny") || set.Contains("allowall") || set.Contains("sameorigin");
    }

    return first switch
    {
      "deny" => true,
      "sameorigin" => self != ancestor,
      _ => false,
    };
  }

  // Fetch's "get, decode, and split" over a combined value.
  private static List<string> GetDecodeSplit(string input)
  {
    var values = new List<string>();
    var position = 0;
    var temporary = new StringBuilder();

    while (true)
    {
      while (position < input.Length && input[position] is not ('"' or ','))
      {
        temporary.Append(input[position]);
        position++;
      }

      if (position < input.Length && input[position] == '"')
      {
        var start = position;
        position++;
        while (position < input.Length)
        {
          var c = input[position];
          position++;
          if (c == '\\')
          {
            if (position < input.Length)
            {
              position++;
            }

            continue;
          }

          if (c == '"')
          {
            break;
          }
        }

        temporary.Append(input, start, position - start);
        if (position < input.Length)
        {
          continue;
        }
      }

      values.Add(temporary.ToString().Trim('\t', ' '));
      temporary.Clear();
      if (position >= input.Length)
      {
        return values;
      }

      position++;
    }
  }
}
