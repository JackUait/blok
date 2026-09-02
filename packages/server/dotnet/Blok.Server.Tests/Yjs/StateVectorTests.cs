using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The v1 state vector codec against the goldens in scenarios.json, which are
/// the bytes a real yjs doc produced for the same delivery schedule. A state
/// vector is the one thing the room must reproduce byte for byte, so every
/// golden is decoded and re-encoded rather than merely parsed.
/// </summary>
public sealed class StateVectorTests
{
  private static readonly byte[] EmptyEncoded = [0];

  private static readonly byte[] TrailingBytes = [0, 0];

  /// <summary>Every expect step's sv golden, deduped.</summary>
  public static TheoryData<string> AllStateVectors()
  {
    return new TheoryData<string>(StateVectorGoldens(minimumClients: 1));
  }

  /// <summary>Only the goldens that can show a client ordering at all.</summary>
  public static TheoryData<string> MultiClientStateVectors()
  {
    return new TheoryData<string>(StateVectorGoldens(minimumClients: 2));
  }

  [Theory]
  [MemberData(nameof(MultiClientStateVectors))]
  public void StateVectorEncodesClientsDescending(string golden)
  {
    var bytes = Convert.FromBase64String(golden);
    var decoded = StateVector.Decode(bytes);

    Assert.True(decoded.Count >= 2);

    var clients = decoded.Select(entry => entry.Key).ToArray();

    Assert.Equal(clients.OrderByDescending(client => client).ToArray(), clients);

    // Rebuilt in the opposite order, so an encoder that leaned on insertion
    // order instead of sorting would produce different bytes.
    var rebuilt = new StateVector();

    foreach (var entry in decoded.OrderBy(entry => entry.Key))
    {
      rebuilt.Set(entry.Key, entry.Value);
    }

    Assert.Equal(bytes, rebuilt.Encode());
  }

  [Theory]
  [MemberData(nameof(AllStateVectors))]
  public void StateVectorDecodeRoundTrips(string golden)
  {
    var bytes = Convert.FromBase64String(golden);
    var decoded = StateVector.Decode(bytes);

    Assert.Equal(bytes, decoded.Encode());

    foreach (var entry in decoded)
    {
      Assert.Equal(entry.Value, decoded.Get(entry.Key));
    }

    Assert.Equal(0UL, decoded.Get(ulong.MaxValue));
  }

  [Fact]
  public void EmptyStateVectorIsOneZeroByte()
  {
    Assert.Equal(EmptyEncoded, StateVector.Empty.Encode());
    Assert.Equal(0, StateVector.Empty.Count);
    Assert.Empty(StateVector.Decode(EmptyEncoded));
  }

  [Fact]
  public void SetOverwritesAClientsClock()
  {
    var vector = new StateVector();

    vector.Set(7, 3);
    vector.Set(7, 9);

    Assert.Equal(9UL, vector.Get(7));
    Assert.Equal(1, vector.Count);
  }

  [Fact]
  public void DecodeRefusesTrailingBytes()
  {
    // The struct decoder refuses trailing bytes for the same reason: leniency
    // there hides a v2 payload or a truncation instead of reporting it.
    Assert.Throws<Lib0FormatException>(() => StateVector.Decode(TrailingBytes));
  }

  private static IEnumerable<string> StateVectorGoldens(int minimumClients)
  {
    var seen = new HashSet<string>(StringComparer.Ordinal);

    foreach (var scenario in YjsEngineFixtures.Cases("scenarios.json"))
    {
      var steps = scenario?["steps"]?.AsArray() ?? [];

      foreach (var step in steps)
      {
        if (step?["expect"]?["sv"] is not JsonValue value ||
            !value.TryGetValue(out string? golden) ||
            !seen.Add(golden))
        {
          continue;
        }

        if (CountClients(golden) >= minimumClients)
        {
          yield return golden;
        }
      }
    }
  }

  /// <summary>The leading varuint of a state vector is its client count.</summary>
  private static int CountClients(string golden)
  {
    var bytes = Convert.FromBase64String(golden);
    var count = 0;
    var shift = 0;

    foreach (var current in bytes)
    {
      count |= (current & 0x7F) << shift;

      if (current < 0x80)
      {
        break;
      }

      shift += 7;
    }

    return count;
  }
}
