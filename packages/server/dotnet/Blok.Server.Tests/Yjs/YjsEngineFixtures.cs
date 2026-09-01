using System.Text.Json.Nodes;
using Blok.Server.Tests.Collab;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// Reads the engine fixtures that scripts/generate-yjs-engine-fixtures.mjs
/// writes (see that script's header for the mechanism). The testhost's cwd is
/// the assembly output directory, so the repository root is found by walking
/// up from it; the fixture directory is derived from that root rather than
/// used as the search marker, so an ungenerated directory reports itself
/// instead of looking like a lost repository.
/// </summary>
internal static class YjsEngineFixtures
{
  private const string RelativeRoot =
      "test/unit/server-conformance/fixtures/yjs-engine";

  private static readonly Lazy<string> RepositoryRootPath = new(LocateRepositoryRoot);

  private static readonly Lazy<string> RootPath = new(LocateRoot);

  /// <summary>Repository checkout root; NodeReplay resolves scripts/ against it.</summary>
  internal static string RepositoryRoot => RepositoryRootPath.Value;

  internal static string Root => RootPath.Value;

  internal static JsonNode ReadJson(string relativePath)
  {
    var path = Path.Combine(Root, relativePath);

    if (!File.Exists(path))
    {
      throw new FileNotFoundException(
          $"{path} does not exist; run node scripts/generate-yjs-engine-fixtures.mjs",
          path);
    }

    return JsonNode.Parse(File.ReadAllText(path)) ??
        throw new InvalidDataException($"{path} holds JSON null");
  }

  /// <summary>Every generated file the manifest names, relative to <see cref="Root"/>.</summary>
  internal static IReadOnlyList<string> ManifestFiles()
  {
    var manifest = ReadJson("manifest.json") as JsonObject ??
        throw new InvalidDataException("manifest.json does not hold a JSON object");
    var files = manifest["files"]?.AsArray() ??
        throw new InvalidDataException(
            "manifest.json has no files array, only: " +
            string.Join(", ", manifest.Select(pair => pair.Key)));

    // The generator writes {path, description, bytes, sha256} per file.
    return files
        .Select(entry => entry?["path"] is JsonValue value && value.TryGetValue(out string? file)
            ? file
            : throw new InvalidDataException(
                $"manifest.json lists {entry?.ToJsonString() ?? "null"}, which has no path"))
        .ToArray();
  }

  /// <summary>The cases array of a fixture file (any.json, structs.json, ...).</summary>
  internal static JsonArray Cases(string relativePath)
  {
    return ReadJson(relativePath)["cases"]?.AsArray() ??
        throw new InvalidDataException($"{relativePath} has no cases array");
  }

  internal static string Canonicalize(JsonNode? node)
  {
    return YDocConverterFixtures.Canonicalize(node);
  }

  private static string LocateRoot()
  {
    var root = Path.Combine(RepositoryRoot, RelativeRoot);

    if (!Directory.Exists(root))
    {
      throw new DirectoryNotFoundException(
          $"{root} does not exist (repository root {RepositoryRoot}); run " +
          "node scripts/generate-yjs-engine-fixtures.mjs");
    }

    return root;
  }

  private static string LocateRepositoryRoot()
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      var marker = Path.Combine(
          directory.FullName, "packages", "server", "dotnet", "Blok.Server.slnx");

      if (File.Exists(marker))
      {
        return directory.FullName;
      }

      directory = directory.Parent;
    }

    throw new DirectoryNotFoundException(
        $"repository root not found: no ancestor of {AppContext.BaseDirectory} " +
        "holds packages/server/dotnet/Blok.Server.slnx");
  }
}
