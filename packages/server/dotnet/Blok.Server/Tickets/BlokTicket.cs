using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Blok.Server.Tickets;

/// <summary>Who an access pass is for, and how long it lives.</summary>
public sealed record BlokTicketClaims
{
  /// <summary>Your own user id. An empty id still verifies, but <c>/sync</c> closes such a pass with 4401.</summary>
  public required string User { get; init; }

  /// <summary>The one document the pass may open. Null leaves the claim out.</summary>
  public string? Doc { get; init; }

  /// <summary>Whether the holder may write. Defaults to false.</summary>
  public bool Write { get; init; }

  /// <summary>Lifetime in whole seconds. Defaults to <see cref="BlokTicket.DefaultTtlSeconds"/>.</summary>
  public long TtlSeconds { get; init; } = BlokTicket.DefaultTtlSeconds;
}

/// <summary>Mints the access pass that ticket mode verifies.</summary>
public static class BlokTicket
{
  /// <summary>The shortest secret ticket mode accepts, in UTF-16 code units.</summary>
  public const int MinimumSecretLength = 32;

  /// <summary>The lifetime used when none is given: 300 seconds.</summary>
  public const long DefaultTtlSeconds = 300;

  /// <summary>Mints a pass with the system clock.</summary>
  /// <param name="secret">The secret the server runs with.</param>
  /// <param name="claims">Who the pass is for.</param>
  /// <returns>The pass.</returns>
  public static string Create(string secret, BlokTicketClaims claims) =>
      Create(secret, claims, TimeProvider.System);

  /// <summary>Mints a pass with the given clock.</summary>
  /// <param name="secret">The secret the server runs with.</param>
  /// <param name="claims">Who the pass is for.</param>
  /// <param name="timeProvider">The clock <c>exp</c> is counted from.</param>
  /// <returns>The pass.</returns>
  public static string Create(string secret, BlokTicketClaims claims, TimeProvider timeProvider)
  {
    ArgumentNullException.ThrowIfNull(secret);
    ArgumentNullException.ThrowIfNull(claims);
    ArgumentNullException.ThrowIfNull(claims.User, nameof(claims));
    ArgumentNullException.ThrowIfNull(timeProvider);

    if (secret.Length < MinimumSecretLength)
    {
      throw new ArgumentException(
          $"the secret must be at least {MinimumSecretLength} characters",
          nameof(secret));
    }

    // The verifier rejects exp <= now, so a zero TTL is dead on arrival.
    ArgumentOutOfRangeException.ThrowIfLessThan(claims.TtlSeconds, 1, nameof(claims));

    // Utf8JsonWriter writes a lone surrogate as U+FFFD: a valid pass for a different id.
    if (HasLoneSurrogate(claims.User) || (claims.Doc is not null && HasLoneSurrogate(claims.Doc)))
    {
      throw new ArgumentException("user and doc must be well-formed UTF-16", nameof(claims));
    }

    var exp = checked(timeProvider.GetUtcNow().ToUnixTimeSeconds() + claims.TtlSeconds);
    using var buffer = new MemoryStream();

    using (var writer = new Utf8JsonWriter(buffer))
    {
      writer.WriteStartObject();
      writer.WriteString("user", claims.User);

      if (claims.Doc is not null)
      {
        writer.WriteString("doc", claims.Doc);
      }

      writer.WriteBoolean("write", claims.Write);
      writer.WriteNumber("exp", exp);
      writer.WriteEndObject();
    }

    var signingInput = $"{TicketVerifier.HeaderSegment}.{Base64Url(buffer.ToArray())}";
    var signature = HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(secret),
        Encoding.UTF8.GetBytes(signingInput));

    return $"{signingInput}.{Base64Url(signature)}";
  }

  private static bool HasLoneSurrogate(string value)
  {
    for (var i = 0; i < value.Length; i++)
    {
      if (char.IsHighSurrogate(value[i]) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
      {
        i++;
      }
      else if (char.IsSurrogate(value[i]))
      {
        return true;
      }
    }

    return false;
  }

  private static string Base64Url(byte[] value) =>
      Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
