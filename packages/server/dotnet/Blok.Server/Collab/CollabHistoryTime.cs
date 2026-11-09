namespace Blok.Server.Collab;

/// <summary>One point in a document's history: a record, or a lineage baseline (sequence 0).</summary>
internal sealed record CollabHistoryPoint(string Lineage, ulong Sequence, DateTimeOffset? CommittedAt);

/// <summary>The records a time range picks, newest first.</summary>
/// <param name="Status">NotFound when <c>before</c> names a lineage the journal does not hold.</param>
/// <param name="Records">Newest first.</param>
/// <param name="Truncated">More records in the range are older than the last one picked.</param>
internal sealed record CollabRangeSelection(
    CollabHistoryStatus Status,
    IReadOnlyList<CollabHistoryPoint> Records,
    bool Truncated);

/// <summary>
/// History by time: the strict time format the routes take, the point a time
/// reads, and the records a time range lists. Go and Rust read the same
/// fixtures (collab-history/at-time.json and changes-range.json).
/// </summary>
internal static class CollabHistoryTime
{
  /// <summary>The default range of the changes-by-time route.</summary>
  public static readonly TimeSpan DefaultRange = TimeSpan.FromHours(24);

  /// <summary>The most lineages one changes-by-time answer replays; each replay starts at its baseline.</summary>
  public const int MaxRangeLineages = 8;

  private const long TicksPerSecond = TimeSpan.TicksPerSecond;
  private const long TicksPerDay = TimeSpan.TicksPerDay;

  /// <summary>
  /// <c>YYYY-MM-DDTHH:MM:SS[.f{1,7}](Z|±HH:MM)</c>, nothing else. The offset is
  /// required: a time without one means a different instant on each server.
  /// Parsed by hand so all three servers take the same strings; seven
  /// fraction digits are .NET's tick.
  /// </summary>
  public static bool TryParse(string? text, out DateTimeOffset at)
  {
    at = default;

    if (text is null || text.Length < 20)
    {
      return false;
    }

    var s = text;
    int Digits(int start, int count)
    {
      var value = 0;

      for (var i = start; i < start + count; i++)
      {
        if (s[i] is < '0' or > '9')
        {
          return -1;
        }

        value = value * 10 + (s[i] - '0');
      }

      return value;
    }

    if (s[4] != '-' || s[7] != '-' || s[10] != 'T' || s[13] != ':' || s[16] != ':')
    {
      return false;
    }

    int year = Digits(0, 4), month = Digits(5, 2), day = Digits(8, 2);
    int hour = Digits(11, 2), minute = Digits(14, 2), second = Digits(17, 2);

    if (year < 1 || month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(Math.Max(year, 1), Math.Clamp(month, 1, 12)) ||
        hour is < 0 or > 23 || minute is < 0 or > 59 || second is < 0 or > 59)
    {
      return false;
    }

    var index = 19;
    long fraction = 0;

    if (s[index] == '.')
    {
      var start = ++index;

      while (index < s.Length && s[index] is >= '0' and <= '9')
      {
        index++;
      }

      var count = index - start;

      if (count is < 1 or > 7)
      {
        return false;
      }

      fraction = Digits(start, count);

      for (var pad = count; pad < 7; pad++)
      {
        fraction *= 10;
      }
    }

    long offsetTicks;

    if (index == s.Length - 1 && s[index] == 'Z')
    {
      offsetTicks = 0;
    }
    else if (index == s.Length - 6 && s[index] is '+' or '-' && s[index + 3] == ':')
    {
      int offsetHours = Digits(index + 1, 2), offsetMinutes = Digits(index + 4, 2);

      if (offsetHours is < 0 or > 14 || offsetMinutes is < 0 or > 59 || (offsetHours == 14 && offsetMinutes > 0))
      {
        return false;
      }

      offsetTicks = (offsetHours * 60L + offsetMinutes) * 60 * TicksPerSecond * (s[index] == '-' ? -1 : 1);
    }
    else
    {
      return false;
    }

    var days = new DateTime(year, month, day).Ticks / TicksPerDay;
    var ticks = days * TicksPerDay + ((hour * 60L + minute) * 60 + second) * TicksPerSecond + fraction - offsetTicks;

    if (ticks < 0 || ticks > DateTimeOffset.MaxValue.UtcTicks)
    {
      return false;
    }

    at = new DateTimeOffset(ticks, TimeSpan.Zero);

    return true;
  }

  /// <summary>
  /// The newest point at or before <paramref name="time"/>. Points are every
  /// record and every baseline with a created-at. Equal times: the later
  /// lineage wins, then the higher sequence. Null when none is that old.
  /// </summary>
  public static CollabHistoryPoint? ResolveAt(
      IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineagesOldestFirst,
      DateTimeOffset time)
  {
    CollabHistoryPoint? best = null;
    var bestLineage = -1;

    void Consider(int lineage, string name, ulong sequence, DateTimeOffset at)
    {
      if (at > time)
      {
        return;
      }

      if (best is { CommittedAt: { } bestAt } &&
          (at < bestAt || (at == bestAt && (lineage < bestLineage || (lineage == bestLineage && sequence < best.Sequence)))))
      {
        return;
      }

      best = new CollabHistoryPoint(name, sequence, at);
      bestLineage = lineage;
    }

    for (var i = 0; i < lineagesOldestFirst.Count; i++)
    {
      var (lineage, headers) = lineagesOldestFirst[i];

      if (lineage.CreatedAt is { } createdAt)
      {
        Consider(i, lineage.Lineage, 0, createdAt);
      }

      foreach (var header in headers)
      {
        Consider(i, lineage.Lineage, header.ServerSequence, header.CommittedAt);
      }
    }

    return best;
  }

  /// <summary>
  /// The records committed in [<paramref name="from"/>, <paramref name="to"/>),
  /// older than <paramref name="before"/> when given, newest first by
  /// lineage then sequence, at most <paramref name="maxRecords"/> from at
  /// most <paramref name="maxLineages"/> lineages.
  /// </summary>
  public static CollabRangeSelection SelectRange(
      IReadOnlyList<(CollabLineageInfo Lineage, IReadOnlyList<CollabRecordHeader> Headers)> lineagesOldestFirst,
      DateTimeOffset from,
      DateTimeOffset to,
      (string Lineage, ulong Sequence)? before,
      int maxRecords,
      int maxLineages = MaxRangeLineages)
  {
    var beforeLineage = lineagesOldestFirst.Count;
    var beforeSequence = ulong.MaxValue;

    if (before is { } point)
    {
      beforeLineage = -1;

      // Lineage ids are unique; if two ever share one, the newest wins.
      for (var i = lineagesOldestFirst.Count - 1; i >= 0; i--)
      {
        if (string.Equals(lineagesOldestFirst[i].Lineage.Lineage, point.Lineage, StringComparison.Ordinal))
        {
          beforeLineage = i;

          break;
        }
      }

      if (beforeLineage < 0)
      {
        return new CollabRangeSelection(CollabHistoryStatus.NotFound, [], false);
      }

      beforeSequence = point.Sequence;
    }

    var picked = new List<CollabHistoryPoint>();
    var lineages = 0;

    for (var i = Math.Min(beforeLineage, lineagesOldestFirst.Count - 1); i >= 0; i--)
    {
      var (lineage, headers) = lineagesOldestFirst[i];

      for (var r = headers.Count - 1; r >= 0; r--)
      {
        var header = headers[r];

        if ((i == beforeLineage && header.ServerSequence >= beforeSequence) ||
            header.CommittedAt < from || header.CommittedAt >= to)
        {
          continue;
        }

        var opens = picked.Count == 0 || picked[^1].Lineage != lineage.Lineage;

        if (picked.Count == maxRecords || (opens && lineages == maxLineages))
        {
          return new CollabRangeSelection(CollabHistoryStatus.Ready, picked, true);
        }

        lineages += opens ? 1 : 0;

        picked.Add(new CollabHistoryPoint(lineage.Lineage, header.ServerSequence, header.CommittedAt));
      }
    }

    return new CollabRangeSelection(CollabHistoryStatus.Ready, picked, false);
  }

  /// <summary>
  /// Whether the next row, newest first, still fits the byte cap. The first
  /// row of an answer always goes out, so a caller can page past it.
  /// </summary>
  public static bool Fits(int kept, long consumed, long size, long maxBytes) =>
      kept == 0 || consumed + size <= maxBytes;

  /// <summary>How many of the rows, newest first, one answer keeps.</summary>
  public static int FitRows(IReadOnlyList<long> sizesNewestFirst, long maxBytes)
  {
    long consumed = 0;
    var kept = 0;

    while (kept < sizesNewestFirst.Count && Fits(kept, consumed, sizesNewestFirst[kept], maxBytes))
    {
      consumed += sizesNewestFirst[kept];
      kept++;
    }

    return kept;
  }
}
