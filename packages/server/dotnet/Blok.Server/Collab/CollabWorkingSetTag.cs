using System.Security.Cryptography;

namespace Blok.Server.Collab;

/// <summary>
/// Identity of a persisted working set. Format names the schema the update
/// frames were produced against (1 = client schema v2). Epoch counts resets.
/// Lineage is 16 random bytes as lower hex, minted every time a fresh CRDT
/// history is created — the first seed, a re-seed after the blob was lost or
/// unreadable, and a reset.
///
/// Lineage exists because the epoch cannot identify a history across blob
/// loss: a corrupt or deleted blob takes its epoch with it, so the doc
/// re-seeds at epoch 0 with a brand-new history that an old epoch-0 client
/// would happily merge into. Clients compare LINEAGE by equality — a
/// different lineage means "drop what you cached, this is not your history".
/// "The epoch never regresses" therefore holds only WITHIN one lineage.
/// </summary>
internal readonly record struct CollabWorkingSetTag(
    int Format,
    long Epoch,
    string Lineage)
{
  internal const int SchemaV2 = 1;

  /// <summary>Length of <see cref="Lineage"/> in hex characters.</summary>
  internal const int LineageLength = 32;

  /// <summary>A room that has not loaded yet holds this; nothing may be persisted or announced under it.</summary>
  internal const string NoLineage = "";

  internal static string NewLineage()
  {
    return Convert.ToHexStringLower(
        RandomNumberGenerator.GetBytes(LineageLength / 2));
  }

  /// <summary>Lower hex only: the client compares lineages as strings.</summary>
  internal static bool IsLineage(string? value)
  {
    if (value is not { Length: LineageLength })
    {
      return false;
    }

    foreach (var character in value)
    {
      if (character is not ((>= '0' and <= '9') or (>= 'a' and <= 'f')))
      {
        return false;
      }
    }

    return true;
  }

  internal bool IsAnnounceable()
  {
    return Format >= 1 && Epoch >= 0 && IsLineage(Lineage);
  }
}
