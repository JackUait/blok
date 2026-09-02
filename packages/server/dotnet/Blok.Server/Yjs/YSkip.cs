namespace Blok.Server.Yjs;

/// <summary>
/// A hole an update declares but does not fill. It is never integrated and
/// never enters the store; it exists so an update carrying pending structs can
/// name the clocks it is skipping over.
/// </summary>
internal sealed class YSkip : YStruct
{
  public override bool IsDeleted => true;
}
