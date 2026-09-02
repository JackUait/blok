using System.Collections;

namespace Blok.Server.Yjs;

/// <summary>
/// Per client, the next clock that client has not produced yet. v1 writes the
/// clients in descending id order, and the room compares these bytes directly,
/// so the ordering is part of the format rather than a detail.
/// </summary>
internal sealed class StateVector : IEnumerable<KeyValuePair<ulong, ulong>>
{
  private readonly Dictionary<ulong, ulong> clocks = [];

  /// <summary>A fresh empty vector; never a shared instance, since this is mutable.</summary>
  public static StateVector Empty => new();

  public int Count => clocks.Count;

  /// <summary>
  /// Refuses trailing bytes and a client listed twice, matching
  /// <see cref="UpdateV1Decoder"/>: leniency there hides a truncation or a v2
  /// payload instead of reporting it.
  /// </summary>
  public static StateVector Decode(ReadOnlySpan<byte> bytes)
  {
    var reader = new Lib0Reader(bytes);
    var vector = new StateVector();
    var count = reader.ReadVarUint();

    for (ulong index = 0; index < count; index++)
    {
      var client = reader.ReadVarUint();
      var clock = reader.ReadVarUint();

      if (!vector.clocks.TryAdd(client, clock))
      {
        throw new Lib0FormatException(
            $"yjs: client {client} is listed twice in a state vector.");
      }
    }

    if (!reader.AtEnd)
    {
      throw new Lib0FormatException(
          $"yjs: {reader.Length - reader.Position} bytes trail the state vector.");
    }

    return vector;
  }

  public byte[] Encode()
  {
    var writer = new Lib0Writer();

    writer.WriteVarUint((ulong)clocks.Count);

    foreach (var entry in clocks.OrderByDescending(entry => entry.Key))
    {
      writer.WriteVarUint(entry.Key);
      writer.WriteVarUint(entry.Value);
    }

    return writer.ToArray();
  }

  /// <summary>0 for a client this vector has never heard of.</summary>
  public ulong Get(ulong client)
  {
    return clocks.TryGetValue(client, out var clock) ? clock : 0;
  }

  public void Set(ulong client, ulong clock)
  {
    clocks[client] = clock;
  }

  public IEnumerator<KeyValuePair<ulong, ulong>> GetEnumerator()
  {
    return clocks.OrderByDescending(entry => entry.Key).GetEnumerator();
  }

  IEnumerator IEnumerable.GetEnumerator()
  {
    return GetEnumerator();
  }
}
