using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Tests.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

internal sealed record YrsCompatCase(string Name, byte[] Update, JsonArray Canonical);

/// <summary>
/// The yrs-encoded corpus: working-set bytes captured from yrs while the
/// native binding was still referenced. yrs bytes are spec-compliant but not
/// byte-identical to yjs, and no more can ever be produced now that the
/// binding is gone, so the committed file is read-only history.
///
/// A recapture would not have been byte-identical anyway: YDocConverter.Seed
/// mints random grid row keys. That changes the bytes, never the exported
/// JSON — which is why the replay test compares canonicalised JSON.
/// </summary>
public sealed class YrsCompatCorpusTests
{
  private const string CorpusFileName = "yrs-compat.json";

  /// <summary>Anchor for the walk up from the test output; it always exists.</summary>
  private const string CollabManifest =
      "test/unit/server-conformance/fixtures/collab/manifest.json";

  private const string RelativeRoot =
      "test/unit/server-conformance/fixtures/yjs-engine";

  private const uint ReplayClientId = 2;

  private static readonly Lazy<IReadOnlyList<YrsCompatCase>> Corpus = new(Read);

  /// <summary>
  /// A subset check, not an equality one: the corpus can only shrink. A new
  /// collab fixture gets no entry because yrs bytes can no longer be produced.
  /// </summary>
  [Fact]
  public void EveryCorpusEntryNamesACollabFixture()
  {
    var cases = Corpus.Value;
    var known = YDocConverterFixtures.CaseNames().ToHashSet(StringComparer.Ordinal);

    Assert.NotEmpty(cases);
    Assert.All(cases, entry =>
    {
      Assert.Contains(entry.Name, known);
      Assert.NotEmpty(entry.Update);
    });
  }

  /// <summary>
  /// The pin: yrs bytes, decoded and integrated by the managed engine, export
  /// the same JSON the client's own fixture says.
  /// </summary>
  [Fact]
  public void CapturedUpdatesApplyIntoTheEngineAndExportTheCanonicalJson()
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

  private static YrsCompatCase[] Read()
  {
    var path = Path.Combine(LocateRoot(), CorpusFileName);

    if (!File.Exists(path))
    {
      throw new FileNotFoundException(
          "the yrs corpus is missing and cannot be recaptured: restore it from git",
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
