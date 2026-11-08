using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp;

/// <summary>
/// blok-mcp's flags and BLOK_* env, read and checked as the blok-mcp tool reads them, for a host
/// that configures Blok the same way (<see cref="ApplyTo"/>). A bad flag throws
/// <see cref="BlokMcpConfigException"/> with blok-mcp's own words.
/// </summary>
public sealed class BlokMcpCommandLine
{
  private readonly McpConfig config;
  private readonly BlokMcpHost host;

  private BlokMcpCommandLine(McpConfig config, BlokMcpHost host)
  {
    this.config = config;
    this.host = host;
  }

  /// <summary>Reads blok-mcp's flags.</summary>
  /// <param name="args">The flags, as blok-mcp takes them.</param>
  /// <param name="environment">The env vars; null reads this process's BLOK_* variables.</param>
  /// <returns>The checked command line.</returns>
  public static async Task<BlokMcpCommandLine> ParseAsync(IReadOnlyList<string> args, IReadOnlyDictionary<string, string>? environment = null)
  {
    ArgumentNullException.ThrowIfNull(args);
    var host = BlokMcpHost.CreateRuntime();

    try
    {
      return new BlokMcpCommandLine(await McpCommandLine.ConfigureAsync(host, args, environment ?? McpCommandLine.ProcessEnvironment()), host);
    }
    catch
    {
      host.Http.Dispose();
      throw;
    }
  }

  /// <summary>The <c>--http</c> address, <c>host:port</c>; null when blok-mcp would serve stdio.</summary>
  public string? HttpListen => config.HttpListen;

  /// <summary>Sets every option the flags name. Options no flag names stay as they are.</summary>
  /// <param name="options">The options to set.</param>
  public void ApplyTo(BlokMcpOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    switch (config.Source)
    {
      case McpSourceConfig.Files files:
        options.FilesDirectory = files.Dir;
        break;
      case McpSourceConfig.Endpoint endpoint:
        options.DocumentEndpoint = new Uri(endpoint.Url);
        options.DocumentEndpointAuthorization = endpoint.EndpointAuth;
        options.DocumentListEndpoint = endpoint.List is null ? null : new Uri(endpoint.List);
        break;
    }
    if (config.OAuth is { } oauth)
    {
      options.OAuth = new BlokMcpOAuthOptions { Issuer = oauth.Issuer, Audience = oauth.Audience, JwksUri = new Uri(oauth.JwksUrl) };
    }
    if (config.Sync is { } sync)
    {
      options.SyncUrl = new Uri(sync.Url);
      options.SyncOrigin = sync.Origin;
    }
    switch (config.Tickets)
    {
      case McpTickets.Secret secret:
        options.TicketSecret = secret.Value;
        break;
      case McpTickets.Url url:
        options.TicketUrl = new Uri(url.Endpoint);
        options.TicketHostToken = url.HostToken;
        break;
    }
    options.PageTitles = config.PageTitles ?? options.PageTitles;
    options.Schema = config.Schema ?? options.Schema;
    if (config.HandleIdleMs is double idle)
    {
      options.HandleIdleTimeout = TimeSpan.FromMilliseconds(idle);
    }
    if (config.MaxHandlesPerPrincipal is double max)
    {
      options.MaxHandlesPerPrincipal = (int)max;
    }
    if (config.Principal is { } principal)
    {
      options.Principal = principal;
    }
    if (config.Comments is bool comments)
    {
      options.Comments = comments;
    }
    if (config.RichTextFields is { } fields)
    {
      options.RichTextFields = fields.ToDictionary(
          pair => pair.Key,
          pair => (pair.Value as JsonArray ?? []).Select(name => McpJson.String(name) ?? string.Empty).ToArray());
    }
    if (config.Manifest is JsonObject manifest)
    {
      options.Manifest = (JsonObject)manifest.DeepClone();
    }
    if (config.Overrides is JsonObject overrides)
    {
      options.Overrides = (JsonObject)overrides.DeepClone();
    }
    if (config.Authorize is { } authorize)
    {
      options.Authorize = async (request, cancellationToken) => await authorize(request.Principal, request.DocumentId, request.Write, cancellationToken);
    }
    if (config.PageCreator is { } pageCreator)
    {
      options.PageCreator = pageCreator;
    }
    options.CommandLineHost = host;
  }
}
