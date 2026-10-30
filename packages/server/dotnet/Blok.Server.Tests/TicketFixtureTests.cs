using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Tests.Yjs;
using Blok.Server.Tickets;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/tickets-extended.json, which the
/// Go server reads too: payloads signed with the fixture secret, raw tokens,
/// and mint inputs, each with what TicketVerifier and BlokTicket answer. C# is
/// the reference, so every answer is recomputed here; run with
/// BLOK_WRITE_FIXTURES=1 to rewrite them after a deliberate change.
/// </summary>
public sealed class TicketFixtureTests
{
  private sealed class FixedTime(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private static string Base64Url(byte[] value) =>
      Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

  private static string Sign(string secret, string payload)
  {
    var input = $"{TicketVerifier.HeaderSegment}.{Base64Url(Encoding.UTF8.GetBytes(payload))}";
    var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(input));
    return $"{input}.{Base64Url(signature)}";
  }

  private static JsonObject Verify(string secret, string token, DateTimeOffset now)
  {
    var answer = new JsonObject();

    try
    {
      var valid = TicketVerifier.TryVerify(secret, token, now, out var claims);
      answer["valid"] = valid;

      if (valid)
      {
        answer["user"] = claims.User;
        answer["doc"] = claims.Document;
        answer["write"] = claims.Write;
        answer["exp"] = claims.Exp;
      }
    }
    catch (Exception error)
    {
      answer["throws"] = error.GetType().Name;
    }

    return answer;
  }

  private static void Check(JsonObject entry, string key, JsonNode answer, bool write)
  {
    if (write)
    {
      entry[key] = answer;
      return;
    }

    Assert.Equal(entry[key]?.ToJsonString(), answer.ToJsonString());
  }

  [Fact]
  public void TicketAnswersMatchTheFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/tickets-extended.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var write = Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1";
    var secret = fixture["secret"]!.GetValue<string>();
    var now = DateTimeOffset.FromUnixTimeSeconds(fixture["now"]!.GetValue<long>());

    foreach (var entry in fixture["payloads"]!.AsArray().Select(node => node!.AsObject()))
    {
      Check(entry, "answer", Verify(secret, Sign(secret, entry["payload"]!.GetValue<string>()), now), write);
    }

    foreach (var entry in fixture["tokens"]!.AsArray().Select(node => node!.AsObject()))
    {
      Check(entry, "answer", Verify(secret, entry["token"]!.GetValue<string>(), now), write);
    }

    Check(fixture, "emptySecretAnswer", Verify("", fixture["emptySecret"]!.GetValue<string>(), now), write);

    foreach (var entry in fixture["mints"]!.AsArray().Select(node => node!.AsObject()))
    {
      var answer = new JsonObject();

      try
      {
        answer["token"] = BlokTicket.Create(
            entry["secret"]!.GetValue<string>(),
            new BlokTicketClaims
            {
              User = entry["user"]!.GetValue<string>(),
              Doc = entry["doc"]?.GetValue<string>(),
              Write = entry["write"]!.GetValue<bool>(),
              TtlSeconds = entry["ttl"]!.GetValue<long>(),
            },
            new FixedTime(now));
      }
      catch (Exception error)
      {
        answer["throws"] = error.GetType().Name;
      }

      Check(entry, "answer", answer, write);
    }

    if (write)
    {
      File.WriteAllText(
          path,
          fixture.ToJsonString(new JsonSerializerOptions
          {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
          }) + "\n");
    }
  }
}
