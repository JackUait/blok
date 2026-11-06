using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp.Auth;

/// <summary>A refused access token; the message is the error_description Node sends.</summary>
internal sealed class AccessTokenException(string message) : Exception(message);

internal sealed record AccessToken(string Principal, string ClientId, IReadOnlyList<string> Scopes);

/// <summary>
/// Blok's access-token rules, as Node's auth/oauth.ts checks them and in the same order:
/// RS256/ES256 only with the key type matched to alg, no crit, typ at+jwt, then the
/// signature, iss, aud, exp, nbf and the subject rules.
/// </summary>
internal sealed class AccessTokenVerifier(
    string issuer,
    string audience,
    Func<CancellationToken, Task<string?>> fetchJwks,
    Func<long>? now = null)
{
  private const long JwksTtlMs = 10 * 60_000;
  // Bounds how often made-up kids, or a down issuer, make us fetch the JWKS.
  private const long MissRefetchCooldownMs = 30_000;

  private readonly Func<long> now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
  private readonly Lock gate = new();
  private Task? pending;
  private Dictionary<string, SigningKey> keys = new(StringComparer.Ordinal);
  private long fetchedAt = long.MinValue / 2;
  private long failedAt = long.MinValue / 2;
  private long lastMissRefetchAt = long.MinValue / 2;

  internal async Task<AccessToken> VerifyAsync(string token, CancellationToken cancellationToken)
  {
    var parts = token.Split('.');
    var header = DecodePart(parts.ElementAtOrDefault(0));
    var claims = DecodePart(parts.ElementAtOrDefault(1));
    var alg = McpJson.String(header["alg"]);

    if ((alg != "RS256" && alg != "ES256") || McpJson.String(header["kid"]) is not string kid || parts.Length != 3)
    {
      throw Invalid("Unsupported token");
    }
    // RFC 7515 §4.1.11: no critical extension is understood here.
    if (header.ContainsKey("crit"))
    {
      throw Invalid("Unsupported critical header");
    }
    // RFC 9068 §4: an ID token for the same audience must not pass as an access token.
    var typ = McpJson.String(header["typ"])?.ToLowerInvariant();

    if (typ is not "at+jwt" and not "application/at+jwt")
    {
      throw Invalid("Not an access token");
    }
    var key = await KeyForAsync(kid, cancellationToken);

    if ((key.Alg is not null && key.Alg != alg) || !key.Fits(alg))
    {
      throw Invalid("Signing key does not match the token algorithm");
    }
    if (!key.Verify(Encoding.UTF8.GetBytes($"{parts[0]}.{parts[1]}"), FromBase64Url(parts[2]) ?? []))
    {
      throw Invalid("Bad signature");
    }
    var nowS = Math.Floor(this.now() / 1000.0);
    var audiences = claims["aud"] is JsonArray list ? list.ToArray() : [claims["aud"]];

    if (McpJson.String(claims["iss"]) != issuer || claims["iss"] is not JsonValue)
    {
      throw Invalid("Wrong issuer");
    }
    // RFC 8707: the token must be issued for this server.
    if (!audiences.Any(entry => McpJson.String(entry) == audience))
    {
      throw Invalid("Token not issued for this server");
    }
    if (McpJson.Number(claims["exp"]) is not double exp || exp <= nowS)
    {
      throw Invalid("Token expired");
    }
    if (McpJson.Number(claims["nbf"]) is double nbf && nbf > nowS)
    {
      throw Invalid("Token not valid yet");
    }
    var scopes = McpJson.String(claims["scope"]) is string scope
        ? scope.Split(' ').Where(entry => entry.Length > 0).ToArray()
        : (claims["scp"] as JsonArray ?? []).Select(McpJson.String).OfType<string>().ToArray();
    var sub = claims["sub"];

    // A missing sub maps to client:<id>, so a sub in that namespace, or none at all, would share handles.
    if (claims.ContainsKey("sub") && (McpJson.String(sub) is not string named || named.Length == 0))
    {
      throw Invalid("Malformed subject");
    }
    if (McpJson.String(sub) is string reserved && reserved.StartsWith("client:", StringComparison.Ordinal))
    {
      throw Invalid("Reserved subject");
    }
    var clientId = new[] { claims["client_id"], claims["azp"], sub }.Select(McpJson.String).FirstOrDefault(value => !string.IsNullOrEmpty(value))
        ?? throw Invalid("Token names no subject or client");
    var principal = McpJson.String(sub) is { Length: > 0 } subject ? subject : $"client:{clientId}";

    return new AccessToken(principal, clientId, scopes);
  }

  private static AccessTokenException Invalid(string message)
  {
    return new AccessTokenException(message);
  }

  private static JsonObject DecodePart(string? part)
  {
    try
    {
      if (FromBase64Url(part ?? string.Empty) is byte[] bytes && McpJson.Parse(Encoding.UTF8.GetString(bytes)) is JsonObject value)
      {
        return value;
      }
    }
    catch (JsonException)
    {
      // Reported below.
    }

    throw Invalid("Malformed token");
  }

  // Node's Buffer.from(x, 'base64url') skips characters outside the alphabet.
  private static byte[]? FromBase64Url(string text)
  {
    var clean = new StringBuilder();

    foreach (var c in text)
    {
      if (char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '+' or '/')
      {
        clean.Append(c is '-' ? '+' : c is '_' ? '/' : c);
      }
      else if (c == '=')
      {
        break;
      }
    }
    if (clean.Length % 4 == 1)
    {
      clean.Length -= 1;
    }
    clean.Append('=', (4 - (clean.Length % 4)) % 4);
    try
    {
      return Convert.FromBase64String(clean.ToString());
    }
    catch (FormatException)
    {
      return null;
    }
  }

  private bool CoolingDown()
  {
    return now() - failedAt < MissRefetchCooldownMs;
  }

  // Concurrent callers share one fetch. It never takes a caller's token: a cancelled
  // request must not fail the fetch other callers wait on.
  private Task RefreshAsync()
  {
    lock (gate)
    {
      pending ??= LoadAsync();

      return pending;
    }
  }

  private async Task LoadAsync()
  {
    // Leaves the lock first, so `pending` is set before the finally below clears it.
    await Task.Yield();
    try
    {
      string? body;

      try
      {
        body = await fetchJwks(CancellationToken.None);
      }
      catch (Exception error) when (error is not OutOfMemoryException)
      {
        body = null;
      }
      var loaded = Parse(body);

      // A set with no usable key would refuse every token, so it counts as a failed fetch.
      if (loaded.Count == 0)
      {
        failedAt = now();

        throw Invalid("Signing keys unavailable");
      }
      keys = loaded;
      fetchedAt = now();
    }
    finally
    {
      lock (gate)
      {
        pending = null;
      }
    }
  }

  private static Dictionary<string, SigningKey> Parse(string? body)
  {
    var parsed = new Dictionary<string, SigningKey>(StringComparer.Ordinal);

    if (body is null)
    {
      return parsed;
    }
    JsonNode? root;

    try
    {
      root = McpJson.Parse(body);
    }
    catch (JsonException)
    {
      return parsed;
    }
    foreach (var entry in (root as JsonObject)?["keys"] as JsonArray ?? [])
    {
      if (entry is JsonObject jwk && McpJson.String(jwk["kid"]) is string kid && SigningKey.From(jwk) is SigningKey key)
      {
        parsed[kid] = key;
      }
    }

    return parsed;
  }

  private async Task<SigningKey> KeyForAsync(string kid, CancellationToken cancellationToken)
  {
    // A failed refresh keeps the keys already trusted; only an empty cache refuses.
    if (now() - fetchedAt > JwksTtlMs && !CoolingDown())
    {
      await TryRefreshAsync(cancellationToken);
    }
    // A miss may mean the issuer rotated keys: refetch, at most once per cooldown.
    if (!keys.ContainsKey(kid))
    {
      Task? running;

      lock (gate)
      {
        running = pending;
      }
      if (running is not null)
      {
        await TryAsync(running.WaitAsync(cancellationToken));
      }
      else if (!CoolingDown() && now() - lastMissRefetchAt >= MissRefetchCooldownMs)
      {
        lastMissRefetchAt = now();
        await TryRefreshAsync(cancellationToken);
      }
    }

    return keys.TryGetValue(kid, out var key)
        ? key
        : throw Invalid(keys.Count == 0 ? "Signing keys unavailable" : "Unknown signing key");
  }

  private Task TryRefreshAsync(CancellationToken cancellationToken)
  {
    return TryAsync(RefreshAsync().WaitAsync(cancellationToken));
  }

  private static async Task TryAsync(Task refresh)
  {
    try
    {
      await refresh;
    }
    catch (AccessTokenException)
    {
      // The cache keeps what it had.
    }
  }

  private sealed class SigningKey(string? alg, RSA? rsa, ECDsa? ec)
  {
    internal string? Alg { get; } = alg;

    // RFC 7517 §4.2: a key published for encryption must not verify signatures.
    internal static SigningKey? From(JsonObject jwk)
    {
      if (jwk.ContainsKey("use") && McpJson.String(jwk["use"]) != "sig")
      {
        return null;
      }
      var alg = jwk.ContainsKey("alg") ? McpJson.String(jwk["alg"]) ?? string.Empty : null;

      try
      {
        switch (McpJson.String(jwk["kty"]))
        {
          case "RSA" when FromBase64Url(McpJson.String(jwk["n"]) ?? string.Empty) is { Length: > 0 } n
              && FromBase64Url(McpJson.String(jwk["e"]) ?? string.Empty) is { Length: > 0 } e:
            var rsa = RSA.Create();

            rsa.ImportParameters(new RSAParameters { Modulus = n, Exponent = e });

            return new SigningKey(alg, rsa, null);
          case "EC" when McpJson.String(jwk["crv"]) == "P-256"
              && FromBase64Url(McpJson.String(jwk["x"]) ?? string.Empty) is { Length: 32 } x
              && FromBase64Url(McpJson.String(jwk["y"]) ?? string.Empty) is { Length: 32 } y:
            return new SigningKey(alg, null, ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = x, Y = y } }));
          default:
            return null;
        }
      }
      catch (CryptographicException)
      {
        // One unusable key must not take the whole set down.
        return null;
      }
    }

    // The header alg must match the key type, or an ES256 key could check an "RS256" token.
    internal bool Fits(string alg)
    {
      return alg == "RS256" ? rsa is not null : alg == "ES256" && ec is not null;
    }

    internal bool Verify(byte[] data, byte[] signature)
    {
      try
      {
        return rsa is not null
            ? rsa.VerifyData(data, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            : ec!.VerifyData(data, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      }
      catch (CryptographicException)
      {
        return false;
      }
    }
  }
}
