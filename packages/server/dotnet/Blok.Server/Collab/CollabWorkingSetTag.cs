namespace Blok.Server.Collab;

/// <summary>
/// Identity of a persisted working set. Format names the schema the update
/// frames were produced against (1 = client schema v2). Epoch is bumped on
/// every reset and never regresses.
/// </summary>
internal readonly record struct CollabWorkingSetTag(int Format, long Epoch)
{
  internal const int SchemaV2 = 1;
}
