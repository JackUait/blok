using System.Text.Json;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.Host.Tests;

/// <summary>
/// The room's stderr lines, from host-log-lines.json, which the Go host's
/// collablog_test.go reads too.
/// </summary>
public sealed class HostCollabLogTests
{
  private const string Fixture = "test/unit/server-conformance/fixtures/host-log-lines.json";

  public static TheoryData<string, string, string, string> Cases()
  {
    var data = new TheoryData<string, string, string, string>();

    foreach (var entry in JsonDocument.Parse(File.ReadAllText(Locate())).RootElement.EnumerateArray())
    {
      data.Add(
          entry.GetProperty("name").GetString() ?? "",
          entry.GetProperty("level").GetString() ?? "",
          entry.GetProperty("message").GetString() ?? "",
          entry.GetProperty("line").GetString() ?? "");
    }

    return data;
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void EscapesControlCharactersInRoomLines(string name, string level, string message, string line)
  {
    using var output = new StringWriter { NewLine = "\n" };
    using var provider = new CollabStandardErrorLoggerProvider(output);
    var logger = provider.CreateLogger("Blok.Server.Collab");

    logger.Log(level == "error" ? LogLevel.Error : LogLevel.Warning, default, message, null, (state, _) => state);

    Assert.True(line == output.ToString(), $"{name}: wrote {JsonSerializer.Serialize(output.ToString())}");
  }

  private static string Locate()
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      var candidate = Path.Combine(directory.FullName, Fixture);

      if (File.Exists(candidate))
      {
        return candidate;
      }

      directory = directory.Parent;
    }

    throw new FileNotFoundException($"no ancestor of {AppContext.BaseDirectory} holds {Fixture}");
  }
}
