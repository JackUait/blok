namespace Blok.Server.Yjs;

/// <summary>
/// One entry in a client's clock line. Every struct owns a contiguous run of
/// clocks starting at <see cref="Id"/>, which is what lets the store binary
/// search a client's list and what makes the clock arithmetic exact.
/// </summary>
internal abstract class YStruct
{
  public YId Id { get; set; }

  public int Length { get; set; }

  public abstract bool IsDeleted { get; }

  /// <summary>The last clock this struct covers; a length-1 struct's own id.</summary>
  public YId LastId => new(Id.Client, Id.Clock + (ulong)Length - 1);
}
