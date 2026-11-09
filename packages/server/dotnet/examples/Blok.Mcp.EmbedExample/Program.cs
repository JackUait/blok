// Blok's MCP tools on your own MCP server.
//
// This host has its own serverInfo ("host-example"), its own instructions, one tool (host_echo)
// and one prompt (host_hello). It adds Blok's blok_* tools and prompts with WithBlok, configured
// by the same flags and env as `blok-mcp` (BlokMcpCommandLine).
//
//   dotnet run --project packages/server/dotnet/examples/Blok.Mcp.EmbedExample -- \
//     --source files:./docs --authorize <url> [--http 127.0.0.1:0]
//
// Signing in is the host's job; this example fakes it (ExampleSignIn):
//   HTTP   `X-Example-User: <name>` signs the caller in as <name>. `X-Example-Signed-In: true`
//          without X-Example-User signs them in without a name. Neither header: anonymous.
//          `X-Example-Scopes: a,b` puts scope claims on the user; Blok ignores them by default.
//   stdio  the one local user, "local".
// Blok refuses anonymous and unnamed callers unless --example-allow-anonymous is given.
//
// Example flags (every other flag goes to Blok):
//   --example-host-tool <name>             the host tool's name (default host_echo)
//   --example-host-prompt <name>           the host prompt's name (default host_hello)
//   --example-allow-anonymous <principal>  serve anonymous callers as this principal
//   --example-source endpoint:<url>        your own document store, as BlokMcpOptions.DocumentSource
//                                          (see ExampleStore; not with --source)
//   --example-caller-error <text>          the host's caller hook throws with this text, as a broken
//                                          sign-in would. Blok logs it and answers -32603
//                                          "Blok could not run this call."
//   --example-caller-scopes <a,b>          the host's caller hook names the caller as above and gives
//                                          exactly these scopes ("" = none), which Blok then enforces.
//                                          Without it the hook gives no scopes and Blok checks none.
//
// The HTTP side keeps only what an example needs: no Origin or Host checks of its own. Those,
// like OAuth, belong to your server.
using System.Net;
using Blok.Mcp.EmbedExample;
using Blok.Server.Mcp;
using Blok.Server.Mcp.Core;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

const string Name = "host-example";

// stdout carries the protocol over stdio, so nothing else may write there.
Console.SetOut(Console.Error);

try
{
  return await RunAsync(args);
}
catch (Exception error) when (error is StartException or BlokMcpConfigException)
{
  await Console.Error.WriteLineAsync($"{Name}: {error.Message}");

  return 2;
}
catch (Exception error)
{
  await Console.Error.WriteLineAsync($"{Name}: {error.Message}");

  return 1;
}

static async Task<int> RunAsync(string[] args)
{
  var (example, blokArgs) = SplitArgs(args);
  var commandLine = await BlokMcpCommandLine.ParseAsync(blokArgs);
  var stdio = commandLine.HttpListen is null;
  string? instructions = null;

  void AddServer(IServiceCollection services, ILoggingBuilder logging, Func<IMcpServerBuilder, IMcpServerBuilder> transport)
  {
    // Blok logs a failing hook or store in full; stderr only, as stdout may carry the protocol.
    logging.ClearProviders();
    logging.AddSimpleConsole().AddFilter(level => level >= LogLevel.Warning);
    services.Configure<Microsoft.Extensions.Logging.Console.ConsoleLoggerOptions>(console => console.LogToStandardErrorThreshold = LogLevel.Trace);

    var mcp = services.AddMcpServer(options =>
    {
      options.ServerInfo = new Implementation { Name = Name, Version = "1.0.0" };
      // Read when each server is built, after Blok gave its part below.
      options.ServerInstructions = instructions;
      // logging is the host's own capability (SDK 2.x marks it obsolete for 2026-07-28): Blok must keep it.
#pragma warning disable MCP9005
      options.Capabilities = new ServerCapabilities { Logging = new LoggingCapability() };
#pragma warning restore MCP9005
    });

    transport(mcp)
        .WithTools([HostSurface.Tool(example.GetValueOrDefault("host-tool") ?? "host_echo")])
        .WithPrompts([HostSurface.Prompt(example.GetValueOrDefault("host-prompt") ?? "host_hello")])
        .WithBlok(options =>
        {
          commandLine.ApplyTo(options);
          if (example.GetValueOrDefault("source") is { } source)
          {
            options.DocumentSource = SourceOf(source, options);
          }
          // stdio has one local user; over HTTP the default reads the user the host signed in.
          if (stdio)
          {
            options.Caller = (_, _) => ValueTask.FromResult<BlokMcpCallerIdentity?>(new BlokMcpCallerIdentity("local"));
          }
          if (example.GetValueOrDefault("caller-scopes") is { } scopes)
          {
            options.Caller = (context, _) => ValueTask.FromResult(CallerWithScopes(context.User, stdio, scopes));
          }
          if (example.GetValueOrDefault("caller-error") is { } callerError)
          {
            options.Caller = (_, _) => throw new InvalidOperationException(callerError);
          }
          options.AnonymousPrincipal = example.GetValueOrDefault("allow-anonymous");
        });
  }

  if (stdio)
  {
    var builder = Host.CreateEmptyApplicationBuilder(new HostApplicationBuilderSettings());

    AddServer(builder.Services, builder.Logging, mcp => mcp.WithStdioServerTransport());
    using var host = builder.Build();

    // Before serving: this also checks Blok's config and the host's names against Blok's.
    instructions = $"Host instructions.\n\n{await host.Services.GetRequiredService<IBlokMcp>().GetInstructionsAsync()}";
    await host.RunAsync();

    return 0;
  }
  var web = WebApplication.CreateSlimBuilder();
  var (address, port) = await ListenAsync(commandLine.HttpListen!);

  web.WebHost.ConfigureKestrel(kestrel =>
  {
    kestrel.AddServerHeader = false;
    kestrel.Listen(address, port);
  });
  web.Services.AddAuthentication(ExampleSignIn.SchemeName).AddScheme<AuthenticationSchemeOptions, ExampleSignIn>(ExampleSignIn.SchemeName, null);
  AddServer(web.Services, web.Logging, mcp => mcp.WithHttpTransport(http => http.SessionMode = HttpServerSessionMode.Stateless));
  await using var app = web.Build();

  instructions = $"Host instructions.\n\n{await app.Services.GetRequiredService<IBlokMcp>().GetInstructionsAsync()}";
  app.UseAuthentication();
  app.MapMcp("/mcp");
  await app.StartAsync();
  var url = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First());

  await Console.Error.WriteLineAsync($"{Name}: listening on http://{url.Host}:{url.Port}/mcp");
  await app.WaitForShutdownAsync();

  return 0;
}

// The caller the default would name (stdio: "local"; HTTP: the signed-in user's sub, else
// NameIdentifier), with the scopes --example-caller-scopes lists.
static BlokMcpCallerIdentity? CallerWithScopes(System.Security.Claims.ClaimsPrincipal? user, bool stdio, string scopes)
{
  var named = stdio ? "local" : user?.FindFirst("sub")?.Value ?? user?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

  return stdio || user?.Identity?.IsAuthenticated == true
      ? new BlokMcpCallerIdentity(named) { Scopes = scopes.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) }
      : null;
}

// --example-source as BlokMcpOptions.DocumentSource.
static ExampleStore SourceOf(string source, BlokMcpOptions options)
{
  if (!source.StartsWith("endpoint:", StringComparison.Ordinal))
  {
    throw new StartException($"--example-source must be endpoint:<url>, got \"{source}\"");
  }
  if (options.FilesDirectory is not null || options.DocumentEndpoint is not null)
  {
    throw new StartException("--example-source cannot be combined with --source");
  }

  return new ExampleStore(source["endpoint:".Length..]);
}

// Splits this example's own flags from the blok-mcp ones. Each example flag takes a value.
static (Dictionary<string, string> Example, List<string> Blok) SplitArgs(string[] args)
{
  string[] flags = ["--example-host-tool", "--example-host-prompt", "--example-allow-anonymous", "--example-source", "--example-caller-error", "--example-caller-scopes"];
  var example = new Dictionary<string, string>(StringComparer.Ordinal);
  var blok = new List<string>();

  for (var index = 0; index < args.Length; index++)
  {
    var arg = args[index];

    if (!flags.Contains(arg))
    {
      blok.Add(arg);
      continue;
    }
    if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
    {
      throw new StartException($"{arg} needs a value");
    }
    example[arg["--example-".Length..]] = args[++index];
  }

  return (example, blok);
}

// host:port, split at the last colon; [::1] loses its brackets.
static async Task<(IPAddress Address, int Port)> ListenAsync(string listen)
{
  var at = listen.LastIndexOf(':');
  var name = listen[..at].Trim('[', ']');
  var port = int.Parse(listen[(at + 1)..], System.Globalization.CultureInfo.InvariantCulture);

  return (IPAddress.TryParse(name, out var address) ? address : (await Dns.GetHostAddressesAsync(name)).First(), port);
}

/// <summary>A start refusal of this example's own: exit 2, as a bad blok-mcp flag.</summary>
internal sealed class StartException(string message) : Exception(message);

/// <summary>The host's own tool and prompt. Their names are the host's; Blok's are checked against them.</summary>
internal static class HostSurface
{
  internal static McpServerTool Tool(string name)
  {
    return McpServerTool.Create(
        (string? text) => new CallToolResult { Content = [new TextContentBlock { Text = text ?? string.Empty }] },
        new McpServerToolCreateOptions { Name = name, Description = "Echoes the text back." });
  }

  internal static McpServerPrompt Prompt(string name)
  {
    return McpServerPrompt.Create(
        () => new GetPromptResult { Messages = [new PromptMessage { Role = Role.User, Content = new TextContentBlock { Text = "Hello from the host." } }] },
        new McpServerPromptCreateOptions { Name = name, Description = "Says hello." });
  }
}
