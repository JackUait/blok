namespace Blok.Server.Yjs;

/// <summary>
/// A collected run of deleted clocks: the content is gone, only the span
/// remains so later clocks still line up. Peers run with gc on, so these
/// arrive on the wire from day one.
/// </summary>
internal sealed class YGc : YStruct
{
  public override bool IsDeleted => true;
}
