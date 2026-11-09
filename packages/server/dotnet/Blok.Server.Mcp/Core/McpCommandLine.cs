using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Blok.Server.Mcp.Auth;

namespace Blok.Server.Mcp.Core;

/// <summary>blok-mcp's command line: the same flags, env vars and checks as the Node CLI.</summary>
internal static partial class McpCommandLine
{
  [GeneratedRegex("^https?://", RegexOptions.CultureInvariant)]
  private static partial Regex WebhookPattern();

  /// <summary>This process's BLOK_* variables, the env blok-mcp reads.</summary>
  internal static Dictionary<string, string> ProcessEnvironment()
  {
    var env = new Dictionary<string, string>(StringComparer.Ordinal);

    foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
    {
      if (entry.Key is string name && name.StartsWith("BLOK_", StringComparison.Ordinal) && entry.Value is string value)
      {
        env[name] = value;
      }
    }

    return env;
  }

  /// <summary>blok-mcp's flags and env, checked as the Node CLI checks them.</summary>
  internal static async Task<McpConfig> ConfigureAsync(BlokMcpHost host, IReadOnlyList<string> args, IReadOnlyDictionary<string, string> environment)
  {
    var env = new JsonObject();

    foreach (var (name, value) in environment)
    {
      if (name.StartsWith("BLOK_", StringComparison.Ordinal))
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
    var pageCreator = McpJson.String(files["createPage"]) is string createPage ? CreatePageWebhook.Create(createPage, host.Http) : null;
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
    if (pageCreator is not null)
    {
      check["createPage"] = true;
    }
    // No handleStore here: that check only looks for the store's functions, which IBlokMcpHandleStore guarantees.
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
    // Made and checked last, so a refused command line leaves no directory; one others can reach refuses to start.
    var handleStore = McpJson.String(files["handleStore"]) is string handleDir ? FilesHandleStore.Open(handleDir) : null;

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
      PageCreator = pageCreator,
      HandleStore = handleStore,
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
