using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Auth;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class AccessTokenVerifierTests : IDisposable
{
  private const string Issuer = "https://issuer.test";
  private const string Audience = "https://mcp.test/mcp";

  private readonly RSA rsa = RSA.Create(2048);
  private readonly ECDsa ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
  private long now = 1_800_000_000_000;
  private int fetches;
  private string? jwks;

  public AccessTokenVerifierTests()
  {
    jwks = Jwks();
  }

  public void Dispose()
  {
    rsa.Dispose();
    ec.Dispose();
  }

  private static string B64(byte[] bytes)
  {
    return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
  }

  private string Jwks()
  {
    var r = rsa.ExportParameters(false);
    var e = ec.ExportParameters(false);

    return new JsonObject
    {
      ["keys"] = new JsonArray(
          new JsonObject { ["kty"] = "RSA", ["kid"] = "rsa-1", ["alg"] = "RS256", ["use"] = "sig", ["n"] = B64(r.Modulus!), ["e"] = B64(r.Exponent!) },
          new JsonObject { ["kty"] = "EC", ["kid"] = "ec-1", ["alg"] = "ES256", ["use"] = "sig", ["crv"] = "P-256", ["x"] = B64(e.Q.X!), ["y"] = B64(e.Q.Y!) },
          new JsonObject { ["kty"] = "RSA", ["kid"] = "enc-1", ["use"] = "enc", ["n"] = B64(r.Modulus!), ["e"] = B64(r.Exponent!) }),
    }.ToJsonString();
  }

  private AccessTokenVerifier Verifier()
  {
    return new AccessTokenVerifier(Issuer, Audience, _ =>
    {
      fetches++;

      return Task.FromResult(jwks);
    }, () => now);
  }

  private JsonObject Claims(Action<JsonObject>? change = null)
  {
    var claims = new JsonObject { ["iss"] = Issuer, ["aud"] = Audience, ["sub"] = "alice", ["scope"] = "blok.read", ["exp"] = (now / 1000) + 3600 };

    change?.Invoke(claims);

    return claims;
  }

  private string Token(JsonObject claims, string alg = "RS256", string kid = "rsa-1", string typ = "at+jwt", Action<JsonObject>? header = null, bool badSignature = false)
  {
    var head = new JsonObject { ["alg"] = alg, ["kid"] = kid, ["typ"] = typ };

    header?.Invoke(head);
    var input = $"{B64(Encoding.UTF8.GetBytes(head.ToJsonString()))}.{B64(Encoding.UTF8.GetBytes(claims.ToJsonString()))}";
    var data = Encoding.UTF8.GetBytes(badSignature ? input + "x" : input);
    var signature = kid.StartsWith("ec", StringComparison.Ordinal)
        ? ec.SignData(data, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation)
        : rsa.SignData(data, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

    return $"{input}.{B64(signature)}";
  }

  private async Task<string> Refusal(string token)
  {
    var error = await Assert.ThrowsAsync<AccessTokenException>(() => Verifier().VerifyAsync(token, CancellationToken.None));

    return error.Message;
  }

  [Fact]
  public async Task AcceptsAnRs256AndAnEs256AccessToken()
  {
    var verifier = Verifier();
    var rs = await verifier.VerifyAsync(Token(Claims()), CancellationToken.None);
    var es = await verifier.VerifyAsync(Token(Claims(), "ES256", "ec-1"), CancellationToken.None);

    Assert.Equal("alice", rs.Principal);
    Assert.Equal(["blok.read"], rs.Scopes);
    Assert.Equal("alice", es.Principal);
  }

  [Fact]
  public async Task RefusesInNodesOrderWithNodesWords()
  {
    Assert.Equal("Malformed token", await Refusal("not-a-jwt"));
    Assert.Equal("Unsupported token", await Refusal(Token(Claims(), alg: "HS256")));
    Assert.Equal("Unsupported token", await Refusal(Token(Claims(), header: h => h.Remove("kid"))));
    Assert.Equal("Unsupported critical header", await Refusal(Token(Claims(), header: h => h["crit"] = new JsonArray())));
    Assert.Equal("Not an access token", await Refusal(Token(Claims(), typ: "JWT")));
    Assert.Equal("Unknown signing key", await Refusal(Token(Claims(), kid: "nope")));
    Assert.Equal("Unknown signing key", await Refusal(Token(Claims(), kid: "enc-1")));
    Assert.Equal("Signing key does not match the token algorithm", await Refusal(Token(Claims(), alg: "ES256", kid: "rsa-1")));
    Assert.Equal("Bad signature", await Refusal(Token(Claims(), badSignature: true)));
    Assert.Equal("Wrong issuer", await Refusal(Token(Claims(c => c["iss"] = "https://other.test"))));
    Assert.Equal("Token not issued for this server", await Refusal(Token(Claims(c => c["aud"] = "https://other.test"))));
    Assert.Equal("Token expired", await Refusal(Token(Claims(c => c["exp"] = now / 1000))));
    Assert.Equal("Token expired", await Refusal(Token(Claims(c => c.Remove("exp")))));
    Assert.Equal("Token not valid yet", await Refusal(Token(Claims(c => c["nbf"] = (now / 1000) + 60))));
    Assert.Equal("Malformed subject", await Refusal(Token(Claims(c => c["sub"] = ""))));
    Assert.Equal("Reserved subject", await Refusal(Token(Claims(c => c["sub"] = "client:x"))));
    Assert.Equal("Token names no subject or client", await Refusal(Token(Claims(c => c.Remove("sub")))));
  }

  [Fact]
  public async Task ComparesTypLowercasedAndReadsAnAudienceList()
  {
    var token = Token(Claims(c => c["aud"] = new JsonArray("x", Audience)), typ: "AT+JWT");

    Assert.Equal("alice", (await Verifier().VerifyAsync(token, CancellationToken.None)).Principal);
  }

  [Fact]
  public async Task NamesAClientWithoutASubjectInItsOwnNamespace()
  {
    var verifier = Verifier();
    var byClient = await verifier.VerifyAsync(Token(Claims(c =>
    {
      c.Remove("sub");
      c["client_id"] = "app-1";
      c["azp"] = "ignored";
      c["scp"] = new JsonArray("blok.read", "blok.write");
      c.Remove("scope");
    })), CancellationToken.None);
    var byAzp = await verifier.VerifyAsync(Token(Claims(c =>
    {
      c.Remove("sub");
      c["azp"] = "app-2";
    })), CancellationToken.None);

    Assert.Equal("client:app-1", byClient.Principal);
    Assert.Equal(["blok.read", "blok.write"], byClient.Scopes);
    Assert.Equal("client:app-2", byAzp.Principal);
  }

  [Fact]
  public async Task RefusesEveryTokenWhileTheKeysCannotBeFetchedAndRetriesOnlyAfterTheCooldown()
  {
    jwks = null;
    var verifier = Verifier();

    var first = await Assert.ThrowsAsync<AccessTokenException>(() => verifier.VerifyAsync(Token(Claims()), CancellationToken.None));
    await Assert.ThrowsAsync<AccessTokenException>(() => verifier.VerifyAsync(Token(Claims()), CancellationToken.None));

    Assert.Equal("Signing keys unavailable", first.Message);
    Assert.Equal(1, fetches);
    jwks = Jwks();
    now += 30_000;
    Assert.Equal("alice", (await verifier.VerifyAsync(Token(Claims(c => c["exp"] = (now / 1000) + 60)), CancellationToken.None)).Principal);
    Assert.Equal(2, fetches);
  }
}
