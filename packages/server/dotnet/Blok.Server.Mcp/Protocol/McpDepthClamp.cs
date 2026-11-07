using System.Text;

namespace Blok.Server.Mcp.Protocol;

/// <summary>
/// Turns every object or array that opens deeper than a limit into [], so no reader here
/// recurses past it. Node parses any depth; what it reads past the limit is only ever refused
/// or ignored. A dropped part that is not valid JSON cuts the text there and appends "!", so the
/// message stays invalid, as it is for Node. Text that fits comes back unchanged.
/// test/unit/server-conformance/fixtures/mcp-depth-clamp.json holds the cases; Go and Rust read it too.
/// </summary>
internal static class McpDepthClamp
{
  /// <summary>
  /// Arguments start at depth 3 (4 in an HTTP batch), so clamped arguments still nest past the
  /// shared 48-level rule and the bundle refuses them in Node's words; and the SDK and engine,
  /// which fail past 64, never see them deeper.
  /// </summary>
  internal const int MessageLimit = 51;

  /// <summary>The shared bundle's MAX_JSON_DEPTH (src/shared/mcp/wire-json.ts).</summary>
  internal const int MaxJsonDepth = 48;

  /// <summary>wire-json.ts's textNestsDeeperThan: brackets inside strings do not count, and the text need not be valid JSON.</summary>
  internal static bool TextNestsDeeperThan(string text, int limit)
  {
    var depth = 0;
    var inString = false;

    for (var at = 0; at < text.Length; at++)
    {
      var c = text[at];

      if (inString)
      {
        if (c == '\\')
        {
          at++;
        }
        else if (c == '"')
        {
          inString = false;
        }
      }
      else if (c == '"')
      {
        inString = true;
      }
      else if (c is '{' or '[')
      {
        depth++;
      }
      else if (c is '}' or ']')
      {
        depth--;
      }
      if (depth > limit)
      {
        return true;
      }
    }

    return false;
  }

  internal static string Clamp(string text, int limit = MessageLimit)
  {
    var depth = 0;
    var inString = false;
    StringBuilder? output = null;
    var from = 0;

    for (var at = 0; at < text.Length; at++)
    {
      var c = text[at];

      if (inString)
      {
        if (c == '\\')
        {
          at++;
        }
        else if (c == '"')
        {
          inString = false;
        }
        continue;
      }
      switch (c)
      {
        case '"':
          inString = true;
          break;
        case '}' or ']':
          depth--;
          break;
        case '{' or '[':
          if (depth < limit)
          {
            depth++;
            break;
          }
          output ??= new StringBuilder(text.Length);
          output.Append(text, from, at - from);
          var end = SkipValue(text, at);

          if (end < 0)
          {
            return output.Append('!').ToString();
          }
          output.Append("[]");
          from = end;
          at = end - 1;
          break;
      }
    }

    return output is null ? text : output.Append(text, from, text.Length - from).ToString();
  }

  private enum Expect { Value, ValueOrClose, Key, KeyOrClose, Colon, CommaOrClose }

  // The index just past the object or array at start, checked as JSON.parse would with a stack
  // instead of recursion; -1 when it is not valid JSON.
  private static int SkipValue(string text, int start)
  {
    var stack = new Stack<char>();
    var state = Expect.Value;
    var at = start;

    while (true)
    {
      while (at < text.Length && text[at] is ' ' or '\t' or '\n' or '\r')
      {
        at++;
      }
      if (at >= text.Length)
      {
        return -1;
      }
      var c = text[at];
      var closed = false;

      switch (state)
      {
        case Expect.KeyOrClose or Expect.Key:
          if (c == '}' && state == Expect.KeyOrClose)
          {
            stack.Pop();
            at++;
            closed = true;
            break;
          }
          if (c != '"' || (at = SkipString(text, at)) < 0)
          {
            return -1;
          }
          state = Expect.Colon;
          break;
        case Expect.Colon:
          if (c != ':')
          {
            return -1;
          }
          at++;
          state = Expect.Value;
          break;
        case Expect.CommaOrClose:
          var top = stack.Peek();

          if (c == ',')
          {
            at++;
            state = top == '{' ? Expect.Key : Expect.Value;
          }
          else if ((c == '}' && top == '{') || (c == ']' && top == '['))
          {
            stack.Pop();
            at++;
            closed = true;
          }
          else
          {
            return -1;
          }
          break;
        default:
          if (c == ']' && state == Expect.ValueOrClose)
          {
            stack.Pop();
            at++;
            closed = true;
            break;
          }
          if (c is '{' or '[')
          {
            stack.Push(c);
            at++;
            state = c == '{' ? Expect.KeyOrClose : Expect.ValueOrClose;
            continue;
          }
          if ((at = c == '"' ? SkipString(text, at) : SkipScalar(text, at)) < 0)
          {
            return -1;
          }
          closed = true;
          break;
      }
      if (closed)
      {
        if (stack.Count == 0)
        {
          return at;
        }
        state = Expect.CommaOrClose;
      }
    }
  }

  private static int SkipString(string text, int at)
  {
    for (at++; at < text.Length; at++)
    {
      var c = text[at];

      if (c == '"')
      {
        return at + 1;
      }
      if (c < 0x20)
      {
        return -1;
      }
      if (c != '\\')
      {
        continue;
      }
      if (++at >= text.Length)
      {
        return -1;
      }
      switch (text[at])
      {
        case '"' or '\\' or '/' or 'b' or 'f' or 'n' or 'r' or 't':
          break;
        case 'u':
          for (var i = 0; i < 4; i++)
          {
            if (++at >= text.Length || !Uri.IsHexDigit(text[at]))
            {
              return -1;
            }
          }
          break;
        default:
          return -1;
      }
    }

    return -1;
  }

  // true, false, null or a JSON number.
  private static int SkipScalar(string text, int at)
  {
    foreach (var literal in (string[])["true", "false", "null"])
    {
      if (string.CompareOrdinal(text, at, literal, 0, literal.Length) == 0)
      {
        return at + literal.Length;
      }
    }
    bool Digits()
    {
      var begin = at;

      while (at < text.Length && char.IsAsciiDigit(text[at]))
      {
        at++;
      }

      return at > begin;
    }
    if (at < text.Length && text[at] == '-')
    {
      at++;
    }
    if (at < text.Length && text[at] == '0')
    {
      at++;
    }
    else if (!Digits())
    {
      return -1;
    }
    if (at < text.Length && text[at] == '.')
    {
      at++;
      if (!Digits())
      {
        return -1;
      }
    }
    if (at < text.Length && text[at] is 'e' or 'E')
    {
      at++;
      if (at < text.Length && text[at] is '+' or '-')
      {
        at++;
      }
      if (!Digits())
      {
        return -1;
      }
    }

    return at;
  }
}
