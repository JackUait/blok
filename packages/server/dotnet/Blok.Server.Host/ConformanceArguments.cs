#if BLOK_SERVER_CONFORMANCE
using System.Globalization;

namespace Blok.Server.Host;

internal sealed record ConformanceParseResult(
    string[] Arguments,
    string? Origin,
    int Port,
    bool Journal,
    string? Error,
    int? KeepAliveMs = null,
    bool RestoreGuards = false,
    bool RestoreTrashesPages = false,
    bool RecordNotes = false,
    bool StampAuthority = false,
    bool FileBytes = false,
    long? FileBytesMaxBytes = null,
    bool FilesCors = false);

internal static class ConformanceArguments
{
  private const string OriginPrefix = "http://127.0.0.1:";
  private const string Requirement =
      "must be exactly http://127.0.0.1:PORT with a port from 1 to 65535 and no userinfo, path, query, or fragment";

  internal static ConformanceParseResult Parse(string[] arguments)
  {
    ArgumentNullException.ThrowIfNull(arguments);

    var filtered = new List<string>(arguments.Length);
    string? origin = null;
    var port = 0;
    var journal = false;
    var restoreGuards = false;
    var restoreTrashesPages = false;
    var recordNotes = false;
    var stampAuthority = false;
    int? keepAliveMs = null;
    var fileBytes = false;
    long? fileBytesMaxBytes = null;
    var filesCors = false;

    for (var index = 0; index < arguments.Length; index++)
    {
      var argument = arguments[index];
      if (argument == "--")
      {
        filtered.AddRange(arguments[index..]);
        break;
      }

      var value = "";
      var recognized = false;

      if (argument is "--conformance-journal" or "-conformance-journal")
      {
        journal = true;
        continue;
      }

      if (argument == "--conformance-restore-guards")
      {
        restoreGuards = true;
        continue;
      }

      if (argument == "--conformance-restore-trashes-pages")
      {
        restoreTrashesPages = true;
        continue;
      }

      if (argument == "--conformance-record-notes")
      {
        recordNotes = true;
        continue;
      }

      if (argument == "--conformance-stamp-authority")
      {
        stampAuthority = true;
        continue;
      }

      if (argument == "--conformance-file-bytes")
      {
        fileBytes = true;
        continue;
      }

      if (argument == "--conformance-files-cors")
      {
        filesCors = true;
        continue;
      }

      if (argument.StartsWith("--conformance-file-bytes-max-bytes=", StringComparison.Ordinal))
      {
        var text = argument["--conformance-file-bytes-max-bytes=".Length..];
        if (!long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var bytes))
        {
          return Error($"--conformance-file-bytes-max-bytes must be a whole number of bytes (got \"{text}\")");
        }

        fileBytesMaxBytes = bytes;
        continue;
      }

      if (argument.StartsWith("--conformance-keep-alive-ms=", StringComparison.Ordinal))
      {
        var text = argument["--conformance-keep-alive-ms=".Length..];
        if (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var milliseconds))
        {
          return Error($"--conformance-keep-alive-ms must be a whole number of milliseconds (got \"{text}\")");
        }

        keepAliveMs = milliseconds;
        continue;
      }

      if (argument is "--conformance-origin" or "-conformance-origin")
      {
        recognized = true;
        if (index + 1 >= arguments.Length)
        {
          return Error(
              "flag needs an argument: -conformance-origin");
        }

        value = arguments[++index];
      }
      else if (argument.StartsWith(
          "--conformance-origin=",
          StringComparison.Ordinal))
      {
        recognized = true;
        value = argument["--conformance-origin=".Length..];
      }
      else if (argument.StartsWith(
          "-conformance-origin=",
          StringComparison.Ordinal))
      {
        recognized = true;
        value = argument["-conformance-origin=".Length..];
      }

      if (!recognized)
      {
        filtered.Add(argument);
        continue;
      }

      var rawOrigin = value;
      var portText = rawOrigin.StartsWith(
          OriginPrefix,
          StringComparison.Ordinal)
        ? rawOrigin[OriginPrefix.Length..]
        : "";
      if (!int.TryParse(
              portText,
              NumberStyles.None,
              CultureInfo.InvariantCulture,
              out var parsedPort) ||
          parsedPort is < 1 or > 65535 ||
          rawOrigin != OriginPrefix + parsedPort.ToString(
              CultureInfo.InvariantCulture))
      {
        return Error(
            $"{Requirement} (got \"{rawOrigin}\")");
      }

      origin = rawOrigin;
      port = parsedPort;
    }

    return new ConformanceParseResult(
        filtered.ToArray(),
        origin,
        port,
        journal,
        null,
        keepAliveMs,
        restoreGuards,
        restoreTrashesPages,
        recordNotes,
        stampAuthority,
        fileBytes,
        fileBytesMaxBytes,
        filesCors);
  }

  private static ConformanceParseResult Error(string error)
  {
    return new ConformanceParseResult(
        [],
        null,
        0,
        false,
        error);
  }
}
#endif
