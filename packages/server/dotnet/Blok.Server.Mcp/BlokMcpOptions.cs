namespace Blok.Server.Mcp;

/// <summary>What the MCP server serves and who may use it. The same choices as blok-mcp's flags.</summary>
public sealed class BlokMcpOptions
{
  /// <summary>A folder of <c>&lt;id&gt;.json</c> documents (blok-mcp <c>--source files:</c>).</summary>
  public string? FilesDirectory { get; set; }

  /// <summary>The host's document route (blok-mcp <c>--source endpoint:</c>). Ignored when <see cref="FilesDirectory"/> is set.</summary>
  public Uri? DocumentEndpoint { get; set; }

  /// <summary>The Authorization header sent to <see cref="DocumentEndpoint"/>, as <c>BLOK_DOC_ENDPOINT_AUTH</c>.</summary>
  public string DocumentEndpointAuthorization { get; set; } = string.Empty;

  /// <summary>The optional list route for <see cref="DocumentEndpoint"/> (<c>--source-list</c>).</summary>
  public Uri? DocumentListEndpoint { get; set; }

  /// <summary>The principal of a caller no Blok bearer token names. Defaults to <c>local</c>.</summary>
  public string Principal { get; set; } = "local";

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
  /// <c>IBlokAuthorization</c> decides; with neither, every caller reaches every document.
  /// </summary>
  public Func<BlokMcpAccessRequest, CancellationToken, ValueTask<bool>>? Authorize { get; set; }

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
