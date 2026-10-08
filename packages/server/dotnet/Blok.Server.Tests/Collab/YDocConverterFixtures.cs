using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;

namespace Blok.Server.Tests.Collab;

/// <param name="CanonicalSegments">
/// The host-shape canonical (rich fields as segments), or null when the
/// fixture predates format 2.
/// </param>
/// <param name="Page">page.json, or null for a case that pins no page fields.</param>
/// <param name="PageCanonical">page-canonical.json; null exactly when <paramref name="Page"/> is.</param>
internal sealed record YDocConverterFixture(
    string Name,
    JsonArray Input,
    JsonArray Canonical,
    byte[] Update,
    JsonArray? CanonicalSegments = null,
    JsonObject? Page = null,
    JsonObject? PageCanonical = null);

/// <summary>
/// Reads the lockstep fixtures that scripts/generate-collab-fixtures.mjs
/// writes from the real client code (see that script's header for the
/// mechanism). The directory is found by walking up from the test output,
/// so the test project file needs no per-fixture link entries.
/// </summary>
internal static class YDocConverterFixtures
{
  private const string RelativeRoot =
      "test/unit/server-conformance/fixtures/collab";

  /// <summary>Frozen format-1 rooms (rich fields as HTML in a plain Y.Text); same layout.</summary>
  private const string Format1RelativeRoot =
      "test/unit/server-conformance/fixtures/collab-format1";

  private static readonly Lazy<string> Root = new(() => LocateRoot(RelativeRoot));

  private static readonly Lazy<string> Format1Root = new(() => LocateRoot(Format1RelativeRoot));

  internal static IReadOnlyList<string> CaseNames()
  {
    return Directory.GetDirectories(Root.Value)
        .Select(Path.GetFileName)
        .OfType<string>()
        .Order(StringComparer.Ordinal)
        .ToArray();
  }

  internal static IReadOnlyList<string> ManifestCaseNames()
  {
    var manifest = JsonNode.Parse(
        File.ReadAllText(Path.Combine(Root.Value, "manifest.json")));
    var cases = manifest?["cases"]?.AsArray() ??
        throw new InvalidDataException("manifest.json has no cases array");

    return cases
        .Select(entry => entry?["name"]?.GetValue<string>() ??
            throw new InvalidDataException("a manifest case has no name"))
        .ToArray();
  }

  internal static IReadOnlyList<string> Format1CaseNames()
  {
    return Directory.GetDirectories(Format1Root.Value)
        .Select(Path.GetFileName)
        .OfType<string>()
        .Order(StringComparer.Ordinal)
        .ToArray();
  }

  internal static YDocConverterFixture Load(string name)
  {
    return LoadFrom(Root.Value, name);
  }

  internal static YDocConverterFixture LoadFormat1(string name)
  {
    return LoadFrom(Format1Root.Value, name);
  }

  private static YDocConverterFixture LoadFrom(string root, string name)
  {
    var directory = Path.Combine(root, name);

    var segments = Path.Combine(directory, "canonical.segments.json");
    var page = Path.Combine(directory, "page.json");
    var pageCanonical = Path.Combine(directory, "page-canonical.json");

    return new YDocConverterFixture(
        name,
        ReadBlocks(Path.Combine(directory, "input.json")),
        ReadBlocks(Path.Combine(directory, "canonical.json")),
        Convert.FromBase64String(
            File.ReadAllText(Path.Combine(directory, "update.b64"))),
        File.Exists(segments) ? ReadBlocks(segments) : null,
        File.Exists(page) ? ReadObject(page) : null,
        File.Exists(pageCanonical) ? ReadObject(pageCanonical) : null);
  }

  /// <summary>The cases that carry page.json.</summary>
  internal static IReadOnlyList<string> PageCaseNames()
  {
    return CaseNames()
        .Where(name => File.Exists(Path.Combine(Root.Value, name, "page.json")))
        .ToArray();
  }

  private static JsonObject ReadObject(string path)
  {
    return JsonNode.Parse(File.ReadAllText(path))?.AsObject() ??
        throw new InvalidDataException($"{path} does not hold a JSON object");
  }

  /// <summary>
  /// Semantic JSON identity: object keys sorted, numbers compared by value
  /// (JS and .NET format the same double differently), strings escaped by
  /// one writer. Compare two of these, never raw JSON text.
  /// </summary>
  internal static string Canonicalize(JsonNode? node)
  {
    using var document = JsonDocument.Parse(
        node?.ToJsonString() ?? "null",
        new JsonDocumentOptions { MaxDepth = YDocConverter.JsonMaxDepth });
    var builder = new StringBuilder();

    Write(document.RootElement, builder);

    return builder.ToString();
  }

  private static void Write(JsonElement element, StringBuilder builder)
  {
    switch (element.ValueKind)
    {
      case JsonValueKind.Object:
        builder.Append('{');

        var first = true;

        foreach (var property in element.EnumerateObject()
            .OrderBy(property => property.Name, StringComparer.Ordinal))
        {
          if (!first)
          {
            builder.Append(',');
          }

          first = false;
          builder.Append(JsonSerializer.Serialize(property.Name));
          builder.Append(':');
          Write(property.Value, builder);
        }

        builder.Append('}');
        break;

      case JsonValueKind.Array:
        builder.Append('[');

        var index = 0;

        foreach (var item in element.EnumerateArray())
        {
          if (index++ > 0)
          {
            builder.Append(',');
          }

          Write(item, builder);
        }

        builder.Append(']');
        break;

      case JsonValueKind.Number:
        builder.Append(NormalizeNumber(element));
        break;

      case JsonValueKind.String:
        builder.Append(JsonSerializer.Serialize(element.GetString()));
        break;

      default:
        builder.Append(element.GetRawText());
        break;
    }
  }

  private static string NormalizeNumber(JsonElement element)
  {
    var value = element.GetDouble();

    return double.IsInteger(value) && Math.Abs(value) <= 9007199254740992d
      ? ((long)value).ToString(CultureInfo.InvariantCulture)
      : value.ToString("R", CultureInfo.InvariantCulture);
  }

  private static JsonArray ReadBlocks(string path)
  {
    // The converter accepts values nested past System.Text.Json's default
    // depth of 64, so a fixture pinning that must be loadable too.
    return JsonNode.Parse(
            File.ReadAllText(path),
            documentOptions: new JsonDocumentOptions { MaxDepth = YDocConverter.JsonMaxDepth })
        ?.AsArray() ??
        throw new InvalidDataException($"{path} does not hold a JSON array");
  }

  private static string LocateRoot(string relativeRoot)
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      var candidate = Path.Combine(directory.FullName, relativeRoot);

      if (File.Exists(Path.Combine(candidate, "manifest.json")))
      {
        return candidate;
      }

      directory = directory.Parent;
    }

    throw new DirectoryNotFoundException(
        $"collab fixtures not found: no ancestor of {AppContext.BaseDirectory} " +
        $"holds {relativeRoot}/manifest.json (run " +
        "node scripts/generate-collab-fixtures.mjs)");
  }
}
