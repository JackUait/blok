using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Mcp;
using Blok.Server.Mcp.Auth;
using Blok.Server.Mcp.Core;

namespace Blok.Mcp;

/// <summary>blok-mcp's command line: the same flags, env vars and exit codes as the Node CLI.</summary>
internal static partial class BlokMcpCli
{
  internal static async Task<int> RunAsync(string[] args, TextWriter stdout)
  {
    var host = BlokMcpHost.CreateRuntime();

    try
    {
      var config = await ConfigureAsync(host, args);

      if (config.HttpListen is null)
      {
        return await BlokMcpStdio.RunAsync(host, config);
      }

      return await BlokMcpHttp.RunAsync(host, config);
    }
    catch (BlokMcpConfigException error)
    {
      await Console.Error.WriteLineAsync($"blok-mcp: {error.Message}");

      return 2;
    }
    // Node's top-level await: any other startup failure prints and exits 1.
    catch (Exception error)
    {
      await Console.Error.WriteLineAsync($"Error: {error.Message}");

      return 1;
    }
    finally
    {
      host.Http.Dispose();
    }
  }

  [GeneratedRegex("^https?://", RegexOptions.CultureInvariant)]
  private static partial Regex WebhookPattern();

  private static async Task<McpConfig> ConfigureAsync(BlokMcpHost host, string[] args)
  {
    var env = new JsonObject();

    foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
    {
      if (entry.Key is string name && name.StartsWith("BLOK_", StringComparison.Ordinal) && entry.Value is string value)
      {
        env[name] = value;
      }
    }
    var parsed = await host.Bundle.CallAsync("mcpParseArgs", new JsonObject
    {
      ["argv"] = new JsonArray([.. args.Select(arg => (JsonNode)arg)]),
      ["env"] = env,
    });

    if (McpJson.String(parsed["error"]) is string refused)
    {
      throw new BlokMcpConfigException(refused);
    }
    var ok = (JsonObject)parsed["ok"]!;
    var options = (JsonObject)ok["options"]!;
    var files = ok["files"] as JsonObject ?? [];
    McpAuthorize? authorize = null;

    if (McpJson.String(files["authorize"]) is string spec)
    {
      authorize = LoadAuthorize(spec, host);
    }
    JsonNode? manifest = null;
    JsonNode? overrides = null;

    if (McpJson.String(files["manifest"]) is string manifestPath)
    {
      manifest = await ConfigFileAsync(host, "manifest", manifestPath);
    }
    if (McpJson.String(files["overrides"]) is string overridesPath)
    {
      overrides = await ConfigFileAsync(host, "overrides", overridesPath);
    }
    var check = (JsonObject)options.DeepClone();

    if (authorize is not null)
    {
      check["authorize"] = true;
    }
    var safety = await host.Bundle.CallAsync("mcpCheckOptions", new JsonObject { ["options"] = check });

    if (McpJson.String(safety["error"]) is string unsafeOptions)
    {
      throw new BlokMcpConfigException(unsafeOptions);
    }
    var config = McpConfig.FromParsed(options);

    if (config.HttpListen is null && config.OAuth is not null)
    {
      throw new BlokMcpConfigException("OAuth authentication needs the HTTP transport (--http)");
    }

    return new McpConfig
    {
      HttpListen = config.HttpListen,
      Public = config.Public,
      OAuth = config.OAuth,
      Sync = config.Sync,
      Tickets = config.Tickets,
      Source = config.Source,
      PageTitles = config.PageTitles,
      RichTextFields = config.RichTextFields,
      Schema = config.Schema,
      HandleIdleMs = config.HandleIdleMs,
      MaxHandlesPerPrincipal = config.MaxHandlesPerPrincipal,
      Principal = config.Principal,
      Comments = config.Comments,
      Manifest = manifest,
      Overrides = overrides,
      Authorize = authorize,
    };
  }

  /// <summary>An http(s) spec is a webhook; anything else is a module path, which only Node can load.</summary>
  private static McpAuthorize LoadAuthorize(string spec, BlokMcpHost host)
  {
    if (WebhookPattern().IsMatch(spec))
    {
      return AuthorizeWebhook.Create(spec, host.Http);
    }
    var path = Path.GetFullPath(spec, Environment.CurrentDirectory);

    if (!File.Exists(path) && !Directory.Exists(path))
    {
      throw new BlokMcpConfigException($"--authorize {spec}: no module at {path}");
    }

    throw new BlokMcpConfigException($"--authorize {spec}: the .NET blok-mcp takes only an http(s) webhook URL");
  }

  private static async Task<JsonNode?> ConfigFileAsync(BlokMcpHost host, string kind, string path)
  {
    string text;

    // Node's read error word for word: .NET says "Access denied" for a folder.
    if (Directory.Exists(path))
    {
      throw new IOException("EISDIR: illegal operation on a directory, read");
    }
    try
    {
      // Bytes, not ReadAllText: that drops a BOM, which JSON.parse refuses.
      text = System.Text.Encoding.UTF8.GetString(await File.ReadAllBytesAsync(path));
    }
    catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
    {
      throw new BlokMcpConfigException($"Cannot read \"{path}\": no such file");
    }
    JsonNode? value;

    try
    {
      value = McpJson.Parse(text);
    }
    catch (JsonException error)
    {
      throw new BlokMcpConfigException($"Invalid JSON in \"{path}\": {error.Message}");
    }
    var checkedFile = await host.Bundle.CallAsync("mcpConfigFile", new JsonObject { ["kind"] = kind, ["value"] = value });

    if (McpJson.String(checkedFile["error"]) is string refused)
    {
      throw new BlokMcpConfigException(refused);
    }

    return checkedFile["value"]?.DeepClone();
  }
}
