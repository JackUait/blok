using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Blok.Server.Tests.Yjs;

internal sealed record NodeReplayResult(
    JsonNode Json,
    byte[] StateVector,
    bool HasPending,
    byte[]? Diff);

/// <summary>
/// Feeds update bytes to the real yjs through scripts/replay-yjs-update.mjs —
/// the C# → Node direction of the interop law. CI has node before the .NET
/// job runs (setup-node-deps). Batch replays where a theory would otherwise
/// spawn one node per case.
/// </summary>
internal static class NodeReplay
{
  private static readonly TimeSpan ReplayTimeout = TimeSpan.FromSeconds(30);

  internal static NodeReplayResult Run(
      IReadOnlyDictionary<string, string> roots,
      IReadOnlyList<byte[]> updates,
      byte[]? stateVectorFor)
  {
    var rootsJson = new JsonObject();

    foreach (var (name, kind) in roots)
    {
      rootsJson[name] = JsonValue.Create(kind);
    }

    var updatesJson = new JsonArray();

    foreach (var update in updates)
    {
      updatesJson.Add(JsonValue.Create(Convert.ToBase64String(update)));
    }

    var request = new JsonObject
    {
      ["roots"] = rootsJson,
      ["updates"] = updatesJson,
      ["stateVectorFor"] = stateVectorFor is null
          ? null
          : JsonValue.Create(Convert.ToBase64String(stateVectorFor)),
    };

    var output = Execute(request.ToJsonString());
    var replay = JsonNode.Parse(output) ??
        throw new InvalidOperationException($"the replay script printed {output}");
    var diff = replay["diff"]?.GetValue<string>();

    return new NodeReplayResult(
        replay["json"] ?? throw new InvalidOperationException("the replay script printed no json"),
        Convert.FromBase64String(
            replay["sv"]?.GetValue<string>() ??
            throw new InvalidOperationException("the replay script printed no sv")),
        replay["hasPending"]?.GetValue<bool>() ??
            throw new InvalidOperationException("the replay script printed no hasPending"),
        diff is null ? null : Convert.FromBase64String(diff));
  }

  private static string Execute(string request)
  {
    var script = Path.Combine(
        YjsEngineFixtures.RepositoryRoot, "scripts", "replay-yjs-update.mjs");
    var startInfo = new ProcessStartInfo("node")
    {
      RedirectStandardInput = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      UseShellExecute = false,
      WorkingDirectory = YjsEngineFixtures.RepositoryRoot,

      // A BOM on stdin would break JSON.parse, and fixture text carries NUL
      // and astral characters through all three pipes.
      StandardInputEncoding = new UTF8Encoding(false),
      StandardOutputEncoding = new UTF8Encoding(false),
      StandardErrorEncoding = new UTF8Encoding(false),
    };

    startInfo.ArgumentList.Add(script);

    using var process = new Process { StartInfo = startInfo };
    var standardOutput = new StringBuilder();
    var standardError = new StringBuilder();

    process.OutputDataReceived += (_, args) =>
    {
      if (args.Data is not null)
      {
        standardOutput.AppendLine(args.Data);
      }
    };

    process.ErrorDataReceived += (_, args) =>
    {
      if (args.Data is not null)
      {
        standardError.AppendLine(args.Data);
      }
    };

    if (!process.Start())
    {
      throw new InvalidOperationException($"could not start node {script}");
    }

    process.BeginOutputReadLine();
    process.BeginErrorReadLine();
    process.StandardInput.Write(request);
    process.StandardInput.Close();

    if (!process.WaitForExit((int)ReplayTimeout.TotalMilliseconds))
    {
      process.Kill(entireProcessTree: true);

      throw new TimeoutException(
          $"node {script} did not finish within {ReplayTimeout}: {standardError}");
    }

    // The argument-less overload waits for the async readers to drain.
    process.WaitForExit();

    if (process.ExitCode != 0)
    {
      throw new InvalidOperationException(
          $"node {script} exited {process.ExitCode}: {standardError}");
    }

    return standardOutput.ToString();
  }
}
