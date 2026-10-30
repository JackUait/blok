using System.Security.Cryptography;
using System.Text;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The C#-captured golden the Go engine is held to. The yjs fixtures prove
/// output is readable by yjs; this proves Go writes the same bytes as C#,
/// which the room relies on (it compares state vectors and relays updates
/// as bytes). Every scenario and fuzz seed is replayed and, after each step,
/// the engine's answers are recorded: the state vector, the full state, diffs
/// against earlier vectors, what the step emitted, the apply result and
/// whether the client id was re-minted.
///
/// Byte blobs are recorded as 48-bit sha256 prefixes to keep the file small.
/// Set BLOK_WRITE_CSHARP_CAPTURE=1 to rewrite it after an intended change;
/// the Go test reads the same file (internal/yjs/capture_test.go).
/// </summary>
public sealed class CSharpCaptureTests
{
  private const string FileName = "csharp-capture.json";

  [Fact]
  public void TheCaptureMatchesTheEngine()
  {
    var built = Build();
    var path = Path.Combine(YjsEngineFixtures.Root, FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_CSHARP_CAPTURE") == "1")
    {
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_CSHARP_CAPTURE=1");
    Assert.Equal(File.ReadAllText(path), built);
  }

  private static string Build()
  {
    var written = new StringBuilder();

    written.Append("{\n  \"$comment\": \"Captured from the C# engine by CSharpCaptureTests. Do not edit by hand.\",\n");
    written.Append("  \"cases\": [\n");

    var cases = ScenarioSupport.Scenarios()
        .Select(testCase => ("scenarios.json", testCase))
        .Concat(ScenarioSupport.FuzzSeeds().Select(seed => ("fuzz", seed)))
        .ToArray();

    for (var index = 0; index < cases.Length; index++)
    {
      var (source, testCase) = cases[index];

      written.Append("    {\"source\": \"").Append(source).Append("\", \"name\": \"")
          .Append(testCase.Name).Append("\", \"steps\": [\n");
      CaptureSteps(testCase, written);
      written.Append("    ]}").Append(index + 1 < cases.Length ? ",\n" : "\n");
    }

    written.Append("  ]\n}\n");

    return written.ToString();
  }

  private static void CaptureSteps(ScenarioCase testCase, StringBuilder written)
  {
    var runner = new ScenarioRunner(testCase);
    var doc = runner.Doc;
    var emitted = new List<YUpdateEvent>();
    byte[]? first = null;
    var previous = doc.EncodeStateVector();

    doc.UpdateEmitted += emitted.Add;

    for (var index = 0; index < testCase.Steps.Count; index++)
    {
      var clientBefore = doc.ClientId;

      emitted.Clear();
      runner.Run(testCase.Steps[index]);

      var sv = doc.EncodeStateVector();

      // The first vector that names a client: a stale peer that has seen part.
      if (first is null && sv.Length > 1)
      {
        first = sv;
      }

      written.Append("      {\"sv\": \"").Append(Convert.ToBase64String(sv))
          .Append("\", \"full\": \"").Append(Hash(doc.EncodeStateAsUpdate()))
          .Append("\", \"prev\": \"").Append(Hash(doc.EncodeStateAsUpdate(previous)))
          .Append("\", \"first\": \"").Append(Hash(doc.EncodeStateAsUpdate(first ?? []))).Append('"');

      // Only what differs from the common case is written, to keep the file small.
      if (doc.HasPending)
      {
        written.Append(", \"pending\": true");
      }

      if (doc.ClientId != clientBefore)
      {
        written.Append(", \"minted\": true");
      }

      if (emitted.Count > 0)
      {
        written.Append(", \"emitted\": [")
            .Append(string.Join(", ", emitted.Select(update =>
                $"{{\"update\": \"{Hash(update.Update)}\", \"local\": {Bool(update.Local)}}}")))
            .Append(']');
      }

      if (runner.LastResult is { } result)
      {
        written.Append(", \"apply\": {\"pendingRemains\": ").Append(Bool(result.PendingRemains))
            .Append(", \"changed\": ").Append(Bool(result.Changed)).Append('}');
      }

      written.Append('}').Append(index + 1 < testCase.Steps.Count ? ",\n" : "\n");
      previous = sv;
    }
  }

  private static string Bool(bool value) => value ? "true" : "false";

  private static string Hash(byte[] bytes)
  {
    return Convert.ToHexString(SHA256.HashData(bytes))[..12].ToLowerInvariant();
  }
}
