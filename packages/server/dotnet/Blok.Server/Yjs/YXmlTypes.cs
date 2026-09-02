namespace Blok.Server.Yjs;

/// <summary>
/// An XML element. Placeholder: it integrates and re-encodes, and exports
/// nothing, because no Blok client writes XML into a room.
/// </summary>
internal sealed class YXmlElement(string? nodeName) : YAbstractType
{
  public string? NodeName { get; } = nodeName;
}

/// <summary>An XML fragment; see <see cref="YXmlElement"/> for the placeholder scope.</summary>
internal sealed class YXmlFragment : YAbstractType
{
}

/// <summary>An XML hook, which carries only its name.</summary>
internal sealed class YXmlHook(string? hookName) : YAbstractType
{
  public string? HookName { get; } = hookName;
}

/// <summary>An XML text node, which exports its string exactly as a Y.Text does.</summary>
internal sealed class YXmlText : YAbstractType
{
  public override string ToString()
  {
    return ConcatenateStrings(Start);
  }
}
