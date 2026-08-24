#if BLOK_SERVER_CONFORMANCE
using System.Globalization;

namespace Blok.Server.Host;

internal sealed record ConformanceParseResult(
    string[] Arguments,
    string? Origin,
    int Port,
    string? Error);

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
        null);
  }

  private static ConformanceParseResult Error(string error)
  {
    return new ConformanceParseResult(
        [],
        null,
        0,
        error);
  }
}
#endif
