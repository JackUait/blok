using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Blok.Server.Mcp;

/// <summary>What the MCP server serves and who may use it. The same choices as blok-mcp's flags.</summary>
public sealed class BlokMcpOptions
{
  /// <summary>A folder of <c>&lt;id&gt;.json</c> documents (blok-mcp <c>--source files:</c>).</summary>
  public string? FilesDirectory { get; set; }

  /// <summary>
  /// The host's own document store, called in code with the caller that opened each handle.
  /// Set it, <see cref="FilesDirectory"/> or <see cref="DocumentEndpoint"/>, not two of them.
  /// </summary>
  public IBlokMcpDocumentSource? DocumentSource { get; set; }

  /// <summary>The host's document route (blok-mcp <c>--source endpoint:</c>). Ignored when <see cref="FilesDirectory"/> is set.</summary>
  public Uri? DocumentEndpoint { get; set; }

  /// <summary>The Authorization header sent to <see cref="DocumentEndpoint"/>, as <c>BLOK_DOC_ENDPOINT_AUTH</c>.</summary>
  public string DocumentEndpointAuthorization { get; set; } = string.Empty;

  /// <summary>The optional list route for <see cref="DocumentEndpoint"/> (<c>--source-list</c>).</summary>
  public Uri? DocumentListEndpoint { get; set; }

  /// <summary>
  /// The principal of a caller no Blok bearer token names. Defaults to <c>local</c>.
  /// <c>AddBlokMcp</c> only: on a host's server (<c>WithBlok</c>) use <see cref="Caller"/> or <see cref="AnonymousPrincipal"/>.
  /// </summary>
  public string Principal
  {
    get => principal ?? "local";
    set => principal = value;
  }

  private string? principal;

  /// <summary>The runtime <see cref="BlokMcpCommandLine"/> started, reused rather than started twice.</summary>
  internal Core.BlokMcpHost? CommandLineHost { get; set; }

  /// <summary>Whether <see cref="Principal"/> was set, which <c>WithBlok</c> refuses.</summary>
  internal bool PrincipalSet => principal is not null;

  /// <summary>
  /// <c>WithBlok</c> only: who calls one tools/call, or null for an anonymous caller. The default
  /// reads the user the host's auth signed in: its <c>sub</c>, else its <c>NameIdentifier</c>, with no scopes.
  /// </summary>
  public Func<RequestContext<CallToolRequestParams>, CancellationToken, ValueTask<BlokMcpCallerIdentity?>>? Caller { get; set; }

  /// <summary>
  /// <c>WithBlok</c> only: serve anonymous callers as this principal. Unset, they are refused.
  /// Every anonymous caller shares it, and its handle limit: pick a name no real user has.
  /// </summary>
  public string? AnonymousPrincipal { get; set; }

  /// <summary>How tool schemas are written: <c>envelope</c>, <c>full</c> or <c>mixed</c> (the default).</summary>
  public string? Schema { get; set; }

  /// <summary>How long an unused handle stays open. Defaults to ten minutes.</summary>
  public TimeSpan? HandleIdleTimeout { get; set; }

  /// <summary>How many handles one principal may hold at once. Defaults to 8.</summary>
  public int? MaxHandlesPerPrincipal { get; set; }

  /// <summary>False when the editors keep comments in the host's own system.</summary>
  public bool Comments { get; set; } = true;

  /// <summary>Extra rich-text fields per block type, as <c>--rich-text-fields</c>.</summary>
  public IDictionary<string, string[]>? RichTextFields { get; set; }

  /// <summary>
  /// The per-document check (blok-mcp <c>--authorize</c>). When unset, a registered
  /// <c>IBlokAuthorization</c> decides. With neither, <c>MapBlokMcp</c> refuses to start
  /// unless <see cref="AllowEveryCallerEveryDocument"/> is set. OAuth alone is not enough:
  /// it says who calls, not which documents they may open.
  /// </summary>
  public Func<BlokMcpAccessRequest, CancellationToken, ValueTask<bool>>? Authorize { get; set; }

  /// <summary>
  /// Lets every caller read and write every document, with no per-document check. Only for
  /// an endpoint nothing untrusted can reach.
  /// </summary>
  public bool AllowEveryCallerEveryDocument { get; set; }

  /// <summary>
  /// The browser origins that may call the endpoint, such as <c>https://app.example</c>.
  /// A request with no <c>Origin</c> header always passes. When unset, only loopback
  /// pages (<c>http://localhost</c>, <c>127.0.0.1</c>, <c>[::1]</c>, any port) may, as blok-mcp --http.
  /// </summary>
  public IList<string>? AllowedOrigins { get; set; }

  /// <summary>
  /// The host names the <c>Host</c> header may carry (any port), against DNS rebinding.
  /// When unset nothing is checked here; use ASP.NET Core's <c>AllowedHosts</c> host filtering.
  /// </summary>
  public IList<string>? AllowedHosts { get; set; }

  /// <summary>
  /// Without <see cref="OAuth"/>, a caller nothing has signed in is named by <see cref="Principal"/>,
  /// so only this machine may call: a request from a non-loopback address gets 403. A user your
  /// own ASP.NET Core auth signed in is always let through. Set this when a proxy in front of the
  /// app, or the network, already decides who may connect.
  /// </summary>
  public bool TrustRemoteCallers { get; set; }

  /// <summary>
  /// Serve live handles from this app's own Blok collab rooms (<c>AddBlokServer</c> with
  /// <c>CollabEnabled</c>), in process: no socket and no ticket. A live handle's revision
  /// is the room's journal head.
  /// </summary>
  public bool LiveRooms { get; set; }

  /// <summary>
  /// The host's uploader for <c>&lt;tool&gt;.uploadFile</c>, as blok-mcp's <c>uploads</c> option.
  /// Without one the upload commands are unavailable.
  /// </summary>
  public BlokMcpUploads? Uploads { get; set; }

  /// <summary>Blok's OAuth rules for bearer tokens (blok-mcp <c>--auth oauth</c>).</summary>
  public BlokMcpOAuthOptions? OAuth { get; set; }

  /// <summary><c>page-map</c> turns on page.rename, page.setIcon and page creation (<c>--page-titles</c>). Default <c>off</c>.</summary>
  public string? PageTitles { get; set; }

  /// <summary>The host's custom tool descriptions, as <c>--manifest &lt;file&gt;</c> holds them. Checked at startup.</summary>
  public System.Text.Json.Nodes.JsonObject? Manifest { get; set; }

  /// <summary>Per-tool overrides, as <c>--manifest-overrides &lt;file&gt;</c> holds them. Checked at startup.</summary>
  public System.Text.Json.Nodes.JsonObject? Overrides { get; set; }

  /// <summary>A remote Blok sync server for live handles (<c>--sync-url</c>). Needs a ticket mode.</summary>
  public Uri? SyncUrl { get; set; }

  /// <summary>The Origin sent to <see cref="SyncUrl"/> (<c>--sync-origin</c>).</summary>
  public string? SyncOrigin { get; set; }

  /// <summary>Signs live tickets with this secret (<c>BLOK_SECRET</c>). Needs <see cref="Authorize"/> or IBlokAuthorization.</summary>
  public string? TicketSecret { get; set; }

  /// <summary>
  /// The host's ticket route (<c>--ticket-url</c>), which also decides who may open what: with no
  /// document source, no other per-document check is needed. Needs <see cref="TicketHostToken"/>.
  /// </summary>
  public Uri? TicketUrl { get; set; }

  /// <summary>The bearer token sent to <see cref="TicketUrl"/> (<c>BLOK_MCP_HOST_TOKEN</c>).</summary>
  public string? TicketHostToken { get; set; }

  /// <summary>
  /// Builds the agent's actor from the principal and client name. A ticket's user must equal its id.
  /// Blocks the agent writes name <c>OnBehalfOf</c> as their author and the actor's id as co-author.
  /// The default actor is <c>agent:&lt;principal&gt;:&lt;client&gt;</c>, on behalf of the principal.
  /// </summary>
  public Func<string, string, BlokMcpAgentActor>? AgentActor { get; set; }
}

/// <summary>The agent as Blok records it.</summary>
/// <param name="Id">Its id; a ticket's user must equal it.</param>
/// <param name="Name">The name peers see.</param>
public sealed record BlokMcpAgentActor(string Id, string Name)
{
  /// <summary>The person it works for; absent names the agent alone.</summary>
  public string? OnBehalfOf { get; init; }

  /// <summary>Its presence colour, as hex.</summary>
  public string? Color { get; init; }
}

/// <summary>One access question: may this principal open this document, for writing or not.</summary>
/// <param name="Principal">Who is asking.</param>
/// <param name="DocumentId">The document.</param>
/// <param name="Write">Whether the caller wants to write.</param>
public sealed record BlokMcpAccessRequest(string Principal, string DocumentId, bool Write);

/// <summary>The authorization server whose access tokens the MCP endpoint accepts.</summary>
public sealed class BlokMcpOAuthOptions
{
  /// <summary>The token issuer (<c>iss</c>).</summary>
  public required string Issuer { get; set; }

  /// <summary>This server's resource URL, which tokens must name in <c>aud</c>.</summary>
  public required string Audience { get; set; }

  /// <summary>Where the issuer publishes its signing keys.</summary>
  public required Uri JwksUri { get; set; }
}

/// <summary>Who calls Blok on a host's server, as the host's <see cref="BlokMcpOptions.Caller"/> says.</summary>
/// <param name="Principal">The caller's stable name. Null or empty: signed in without a name, which Blok refuses.</param>
public sealed record BlokMcpCallerIdentity(string? Principal)
{
  /// <summary>
  /// OAuth-style scopes. Null (the default) skips Blok's blok.read and blok.write checks, since
  /// the host owns auth; a list makes Blok enforce them as the standalone server does.
  /// </summary>
  public IReadOnlyList<string>? Scopes { get; init; }
}
