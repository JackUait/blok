namespace Blok.Server.Yjs;

/// <summary>
/// One unit of change. Everything integrated or deleted inside it lands in
/// the same emitted update, and the before/after state vectors are what make
/// that update a diff rather than a snapshot.
/// </summary>
internal sealed class YTransaction
{
  internal YTransaction(YDoc doc, bool local)
  {
    Doc = doc;
    Local = local;
    BeforeState = doc.Store.GetStateVector();
  }

  public YDoc Doc { get; }

  /// <summary>Snapshot taken before the body ran; the diff starts here.</summary>
  public StateVector BeforeState { get; }

  /// <summary>Filled at cleanup, once nothing more can be integrated.</summary>
  public StateVector? AfterState { get; internal set; }

  /// <summary>Deletions made in this transaction, not the store's whole history.</summary>
  public DeleteSet DeleteSet { get; } = new();

  /// <summary>
  /// False for an applied remote update. yjs flips it on a reused
  /// transaction, so applying an update inside a local one is not local.
  /// </summary>
  public bool Local { get; internal set; }

  /// <summary>
  /// Right halves of every split, yjs's merge queue. This release does not
  /// merge items (Global Constraints), so nothing reads it; it is kept
  /// because the split sites are the only place that could fill it later.
  /// </summary>
  internal List<YStruct> MergeStructs { get; } = [];
}
