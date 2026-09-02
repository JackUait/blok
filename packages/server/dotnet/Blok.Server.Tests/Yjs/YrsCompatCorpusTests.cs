using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Tests.Collab;
using Blok.Server.Yjs;
using Xunit;
using YDotNet.Document;
using YDotNet.Document.Options;
using YDotNet.Document.Transactions;

namespace Blok.Server.Tests.Yjs;

internal sealed record YrsCompatCase(string Name, byte[] Update, JsonArray Canonical);

/// <summary>
/// The yrs-encoded corpus. Every working set ever persisted by this server
/// was encoded by yrs through YDotNet, and yrs bytes are spec-compliant but
/// not byte-identical to yjs. Once YDotNet is deleted no such bytes can be
/// produced again, so they are captured here while the package is still
/// referenced and committed as a fixture the managed engine is pinned to.
///
/// Run with BLOK_CAPTURE_YRS_CORPUS=1 to (re)capture; without it the tests
/// only read the committed file. The capture branch dies with YDotNet; the
/// file outlives it.
///
/// A recapture is NOT byte-identical: YDocConverter.Seed mints random grid
/// row keys. That changes the bytes, never the exported JSON — which is why
/// the replay test compares canonicalised JSON and not the raw update.
///
/// Only the 20 collab fixtures go in. The NUL-bearing canary in
/// YDocConverterHardeningTests must never be captured: reading it panics
/// inside yrs and aborts the whole test host.
/// </summary>
public sealed class YrsCompatCorpusTests
{
  private const string CaptureVariable = "BLOK_CAPTURE_YRS_CORPUS";
  private const string CorpusFileName = "yrs-compat.json";
  private const string YrsVersion = "0.19.1 via YDotNet 0.6.0";

  /// <summary>Anchor for the walk up from the test output; it always exists.</summary>
  private const string CollabManifest =
      "test/unit/server-conformance/fixtures/collab/manifest.json";

  private const string RelativeRoot =
      "test/unit/server-conformance/fixtures/yjs-engine";

  /// <summary>Pinned so a recapture differs only where Seed is random.</summary>
  private const uint CaptureClientId = 1;

  private const uint ReplayClientId = 2;

  private static readonly byte[] EmptyStateVector = [0];

  /// <summary>Relaxed so base64 keeps its "+" and the sibling Node-written fixtures match.</summary>
  private static readonly JsonSerializerOptions IndentedJson = new()
  {
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    WriteIndented = true,
  };

  private static readonly Lazy<IReadOnlyList<YrsCompatCase>> Corpus = new(LoadCorpus);

  [Fact]
  public void CorpusHoldsEveryCollabFixture()
  {
    var cases = Corpus.Value;

    Assert.Equal(
        YDocConverterFixtures.CaseNames().Order(StringComparer.Ordinal),
        cases.Select(entry => entry.Name));
    Assert.All(cases, entry => Assert.NotEmpty(entry.Update));
  }

  /// <summary>
  /// The pin: yrs bytes, decoded and integrated by the managed engine, export
  /// the same JSON the client's own fixture says.
  /// </summary>
  [Fact]
  public void CapturedUpdatesApplyBackAndExportTheCanonicalJson()
  {
    foreach (var entry in Corpus.Value)
    {
      var doc = new YDoc(ReplayClientId);

      Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(entry.Update).Outcome);

      var expected = YDocConverterFixtures.Canonicalize(entry.Canonical);
      var actual = YDocConverterFixtures.Canonicalize(YDocConverter.Export(doc));

      Assert.True(
          string.Equals(expected, actual, StringComparison.Ordinal),
          $"{entry.Name}: replaying the yrs update does not export the canonical JSON.\n" +
          $"expected: {expected}\n" +
          $"actual:   {actual}");
    }
  }

  private static YrsCompatCase[] LoadCorpus()
  {
    if (string.Equals(
        Environment.GetEnvironmentVariable(CaptureVariable),
        "1",
        StringComparison.Ordinal))
    {
      Capture();
    }

    return Read();
  }

  private static void Capture()
  {
    var cases = new JsonArray();

    foreach (var name in YDocConverterFixtures.CaseNames().Order(StringComparer.Ordinal))
    {
      var fixture = YDocConverterFixtures.Load(name);
      var source = new YDoc(CaptureClientId);

      YDocConverter.Seed(source, fixture.Input);

      // Round-tripped through yrs so the bytes are YRS's, not the engine's:
      // that is the whole point of the corpus.
      using var doc = new Doc(new DocOptions { Id = CaptureClientId });

      using (var transaction = doc.WriteTransaction())
      {
        Assert.Equal(
            TransactionUpdateResult.Ok,
            transaction.ApplyV1(source.EncodeStateAsUpdate()));
      }

      byte[] update;

      using (var transaction = doc.ReadTransaction())
      {
        update = transaction.StateDiffV1(EmptyStateVector);
      }

      cases.Add(new JsonObject
      {
        ["name"] = name,
        ["update"] = Convert.ToBase64String(update),
        ["canonical"] = fixture.Canonical.DeepClone(),
      });
    }

    var corpus = new JsonObject
    {
      ["yrs"] = YrsVersion,
      ["cases"] = cases,
    };

    var directory = LocateRoot();
    Directory.CreateDirectory(directory);
    File.WriteAllText(
        Path.Combine(directory, CorpusFileName),
        corpus.ToJsonString(IndentedJson) + "\n");
  }

  private static YrsCompatCase[] Read()
  {
    var path = Path.Combine(LocateRoot(), CorpusFileName);

    if (!File.Exists(path))
    {
      throw new FileNotFoundException(
          $"the yrs corpus is missing: run the suite once with " +
          $"{CaptureVariable}=1 while YDotNet is still referenced",
          path);
    }

    var cases = JsonNode.Parse(File.ReadAllText(path))?["cases"]?.AsArray() ??
        throw new InvalidDataException($"{path} has no cases array");

    return cases
        .Select(entry => new YrsCompatCase(
            entry?["name"]?.GetValue<string>() ??
                throw new InvalidDataException($"{path}: a case has no name"),
            Convert.FromBase64String(
                entry["update"]?.GetValue<string>() ??
                    throw new InvalidDataException($"{path}: a case has no update")),
            entry["canonical"]?.AsArray() ??
                throw new InvalidDataException($"{path}: a case has no canonical")))
        .ToArray();
  }

  private static string LocateRoot()
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      if (File.Exists(Path.Combine(directory.FullName, CollabManifest)))
      {
        return Path.Combine(directory.FullName, RelativeRoot);
      }

      directory = directory.Parent;
    }

    throw new DirectoryNotFoundException(
        $"no ancestor of {AppContext.BaseDirectory} holds {CollabManifest}");
  }
}
