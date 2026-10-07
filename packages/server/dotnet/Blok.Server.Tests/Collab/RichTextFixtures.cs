using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Reads the rich-text fixtures under test/unit/server-conformance/fixtures/.
/// The TS suite pins each of them against the real client functions, so a C#
/// test that reads one is pinned against the client too.
/// </summary>
internal static class RichTextFixtures
{
  private const string RelativeRoot = "test/unit/server-conformance/fixtures";

  private static readonly Lazy<string> Root = new(LocateRoot);

  internal static string PathOf(string relative)
  {
    return Path.Combine(Root.Value, relative);
  }

  /// <summary>As JSON.parse reads it: engine values, numbers as doubles.</summary>
  internal static object? ReadEngine(string relative)
  {
    return JsJson.Parse(File.ReadAllText(PathOf(relative)));
  }

  internal static JsonNode ReadJson(string relative)
  {
    return JsonNode.Parse(File.ReadAllText(PathOf(relative))) ??
        throw new InvalidDataException($"{relative} is empty");
  }

  private static string LocateRoot()
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      var candidate = Path.Combine(directory.FullName, RelativeRoot);

      if (Directory.Exists(Path.Combine(candidate, "rich-text-canonical")))
      {
        return candidate;
      }

      directory = directory.Parent;
    }

    throw new DirectoryNotFoundException(
        $"rich-text fixtures not found above {AppContext.BaseDirectory}");
  }
}
