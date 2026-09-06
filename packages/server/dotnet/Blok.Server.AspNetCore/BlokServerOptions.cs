using System.Globalization;
using System.Net;

namespace Blok.Server.AspNetCore;

/// <summary>
/// Everything the Blok server is configured by. The standalone
/// <c>blok-server</c> host fills it from its command line; an application
/// hosting Blok in-process sets it directly.
/// </summary>
/// <remarks>
/// The instance handed to <c>AddBlokServer</c> IS the registered singleton,
/// and several services read it lazily, so a value changed after registration
/// is still seen. <see cref="Validate"/> is what refuses combinations that do
/// not work together.
/// </remarks>
public sealed class BlokServerOptions
{
  private const long DefaultMaxUploadBytes = 32L << 20;

  /// <summary>
  /// Reported by <c>GET /health</c> and in the standalone host's startup line.
  /// This is the deployment's own version, not the Blok library's and not a
  /// document schema version.
  /// </summary>
  public string Version { get; set; } = "dev";

  /// <summary>
  /// <c>host:port</c> the standalone host binds. Validated even in-process,
  /// because <see cref="Auth"/> "none" and "proxy" are allowed only on
  /// loopback and that is decided from this string. A DNS host other than
  /// localhost is refused: it would bind every interface.
  /// </summary>
  public string ListenAddress { get; set; } = "127.0.0.1:4000";

  /// <summary>
  /// Access mode: "none", "proxy", or "ticket". The first two trust every
  /// caller and may therefore bind loopback only; "ticket" verifies a signed
  /// pass against <see cref="Secret"/> and is the only mode that may be
  /// exposed.
  /// </summary>
  public string Auth { get; set; } = "none";

  /// <summary>
  /// Shared secret ticket passes are signed and verified with; at least 32
  /// characters in ticket mode. The standalone host reads it from
  /// <c>BLOK_SECRET</c> unless a flag overrides — a flag lands in this
  /// machine's process list.
  /// </summary>
  public string Secret { get; set; } = "";

  /// <summary>
  /// Origins allowed to call this service, checked on requests and on the sync
  /// upgrade. Required in ticket mode: without it anyone who finds this
  /// address can drive requests at third-party sites from this server's IP.
  /// </summary>
  public IList<string> AllowedOrigins { get; set; } = [];

  /// <summary>
  /// Directory uploaded files are written to and served from. Empty with no
  /// <see cref="S3Bucket"/> means blob storage is off, and the upload routes
  /// are then never mapped.
  /// </summary>
  public string StorageDirectory { get; set; } = "";

  /// <summary>
  /// URL prefix stored files are handed out under: a full HTTP(S) URL, or a
  /// root-relative path for local storage. It is also the only prefix a delete
  /// recognises a file by, so changing it strands what was already stored.
  /// </summary>
  public string PublicUrl { get; set; } = "";

  /// <summary>
  /// Largest upload accepted, in bytes (32 MiB by default). Must be positive —
  /// a zero cap refuses every upload — and no larger than
  /// <see cref="Array.MaxLength"/> while remote URL upload is open, because
  /// that path buffers the fetched response.
  /// </summary>
  public long MaxUploadBytes { get; set; } = DefaultMaxUploadBytes;

  /// <summary>
  /// Requests a minute per caller; 0 turns the limiter off. The standalone
  /// host defaults it to 60 in ticket mode and to 0 otherwise.
  /// </summary>
  public long RateLimitPerMinute { get; set; }

  /// <summary>
  /// Closes <c>GET /unfurl</c> and <c>POST /upload-by-url</c>, and defaults to
  /// closed. Both make this server fetch a URL its caller chose, which is
  /// reachability the caller does not otherwise have; the guarded outbound
  /// policy is the only thing keeping that off the internal network. The
  /// standalone host opens them and takes that trade deliberately.
  /// </summary>
  public bool UnfurlDisabled { get; set; } = true;

  /// <summary>
  /// S3-compatible endpoint: a full HTTP(S) origin with no credentials, path,
  /// query or fragment. Plain HTTP is accepted only against loopback.
  /// </summary>
  public string S3Endpoint { get; set; } = "";

  /// <summary>
  /// S3 region. Required with a bucket: an empty region is signed into every
  /// request and would fail only at the first upload.
  /// </summary>
  public string S3Region { get; set; } = "";

  /// <summary>
  /// S3 bucket uploads go to. Set it to put blob storage in S3 instead of
  /// <see cref="StorageDirectory"/>; it needs the endpoint, region, bucket URL
  /// and credentials.
  /// </summary>
  public string S3Bucket { get; set; } = "";

  /// <summary>
  /// Public URL prefix stored objects are built from, and the only prefix a
  /// delete recognises one under. A full HTTP(S) URL with no query or
  /// fragment.
  /// </summary>
  public string S3BucketUrl { get; set; } = "";

  /// <summary>
  /// "path" or "virtual", or empty to choose from the endpoint. Set it when
  /// the endpoint is a bucket-per-host service or an emulator that only
  /// answers path-style requests.
  /// </summary>
  public string S3Addressing { get; set; } = "";

  /// <summary>
  /// S3 access key. The standalone host reads it from
  /// <c>BLOK_S3_ACCESS_KEY</c> and offers no flag for it, deliberately: a flag
  /// lands in this machine's process list.
  /// </summary>
  public string S3AccessKey { get; set; } = "";

  /// <summary>
  /// S3 secret key, read from <c>BLOK_S3_SECRET_KEY</c> for the same reason as
  /// <see cref="S3AccessKey"/>.
  /// </summary>
  public string S3SecretKey { get; set; } = "";

  /// <summary>
  /// Serve collaborative sync rooms. Off, the sync, reset and edit routes are
  /// never mapped; on, it needs <see cref="DocEndpoint"/> and somewhere to put
  /// the working set.
  /// </summary>
  public bool CollabEnabled { get; set; }

  /// <summary>
  /// HTTP(S) URL sync rooms seed documents from and export them back to — the
  /// application's own document store, and the authority a room is answerable
  /// to. Plain HTTP is accepted only against loopback.
  /// </summary>
  public string DocEndpoint { get; set; } = "";

  /// <summary>
  /// Authorization header sent with every doc-endpoint request. It must not
  /// contain a line break — a trailing newline from <c>echo</c> or a file is
  /// the usual cause, and the header would be dropped from every request
  /// silently. The standalone host reads it from
  /// <c>BLOK_DOC_ENDPOINT_AUTH</c>.
  /// </summary>
  public string DocEndpointAuth { get; set; } = "";

  /// <summary>
  /// Directory the collaboration working set is kept in. It must not resolve
  /// inside <see cref="StorageDirectory"/>: uploaded files are served
  /// publicly, and the working set would be downloadable by anyone.
  /// </summary>
  public string CollabDirectory { get; set; } = "";

  /// <summary>
  /// S3 key prefix for the collaboration working set, needing
  /// <see cref="S3Bucket"/>. It is the alternative to
  /// <see cref="CollabDirectory"/>, and collaboration needs one of the two.
  /// </summary>
  public string CollabS3Prefix { get; set; } = "";

  /// <summary>
  /// Live sync connections one user may hold on one document. Must be
  /// positive: a zero cap refuses every sync connection.
  /// </summary>
  public int CollabMaxConnectionsPerUserPerDoc { get; set; } = 8;

  /// <summary>
  /// Live sync connections the whole process may hold, everybody together
  /// (0 = no ceiling). Past it an upgrade is refused 503 BEFORE the room is
  /// seeded. Set it to the same number as Kestrel's
  /// MaxConcurrentUpgradedConnections: Kestrel's own refusal comes only after
  /// the seed, as a 500.
  /// </summary>
  public long CollabMaxConnections { get; set; }

  /// <summary>
  /// Largest inbound sync frame and edit body, and the ceiling announced to
  /// clients in the limits frame so they can split their own writes. Must be
  /// positive: a zero cap closes every connection on its first frame.
  /// </summary>
  public int CollabMaxMessageBytes { get; set; } = 1 << 20;

  /// <summary>
  /// WebSocket keep-alive ping interval; zero turns pings off. A socket that
  /// does not answer within twice this is aborted, which is what frees a dead
  /// connection's slot in the per-user cap.
  /// </summary>
  public TimeSpan CollabKeepAliveInterval { get; set; } = TimeSpan.FromSeconds(15);

  /// <summary>
  /// Inbound frames one sync connection may sustain per second (0 = no limit).
  /// A fast typist commits ~10 updates a second and moves the cursor at about
  /// 10 Hz, so ~25 frames/s is the busiest legitimate connection; 50 is double
  /// that.
  /// </summary>
  public int CollabInboundFramesPerSecond { get; set; } = 50;

  /// <summary>
  /// Inbound frames one sync connection may send back-to-back before the
  /// per-second rate binds — enough for a reconnect flurry or a large paste.
  /// </summary>
  public int CollabInboundBurstFrames { get; set; } = 100;

  /// <summary>
  /// Whole-document resyncs (SyncStep1) and presence re-queries
  /// (queryAwareness) one connection may sustain per minute (0 = no limit).
  /// Each resync makes the room diff the whole document back at the sender,
  /// and each re-query makes every OTHER member re-encode all the presence it
  /// holds, so these are the amplifying frames. A client sends one resync per
  /// connect (the most eager re-ask every 5 seconds, ~12/min) and never sends
  /// a re-query.
  /// </summary>
  public int CollabInboundResyncsPerMinute { get; set; } = 60;

  /// <summary>
  /// Presence bytes one sync connection may sustain per second (0 = no
  /// limit). Frames are metered by count, not size, so without this one
  /// connection may push 50 MiB/s of awareness — and the room hands every
  /// byte to every other member. A cursor at 10 Hz is ~3 KB/s and a full
  /// presence reply in a busy room is tens of KB, so 128 KiB is far above
  /// any real client.
  /// </summary>
  public int CollabInboundAwarenessBytesPerSecond { get; set; } = 128 << 10;

  internal bool HasStorage => StorageDirectory != "" || S3Bucket != "";

  internal string LocalPublicPath { get; private set; } = "";

  /// <summary>
  /// Throws unless these options work together, and resolves the public path
  /// local files are served under.
  /// </summary>
  /// <remarks>
  /// Called by <c>AddBlokServer</c>, by <c>MapBlokServer</c>, and again inside
  /// the lazy service factories, so a value changed after registration is
  /// still checked before it is used. It is idempotent.
  /// </remarks>
  /// <exception cref="InvalidOperationException">
  /// One option is malformed, or two are set to a combination that cannot
  /// serve — an exposed listen address under an auth mode that trusts every
  /// caller, a bucket with no region, a working set inside the public upload
  /// directory. The message names the flag and what breaks.
  /// </exception>
  public void Validate()
  {
    LocalPublicPath = "";
    switch (Auth)
    {
      case "none" when !IsLoopback(ListenAddress):
        throw new InvalidOperationException(
            $"--auth none serves anyone who can reach \"{ListenAddress}\"{BindScope(ListenAddress)}; " +
            "it may only bind loopback — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service");
      case "proxy" when !IsLoopback(ListenAddress):
        throw new InvalidOperationException(
            $"--auth proxy trusts every caller, so it may only bind loopback, not \"{ListenAddress}\"" +
            $"{BindScope(ListenAddress)} — use --listen 127.0.0.1:PORT, or --auth ticket to expose this service");
      case "ticket" when Secret.Length < 32:
        throw new InvalidOperationException(
            $"--secret must be at least 32 characters (got {Secret.Length})");
      case "ticket" when AllowedOrigins.Count == 0:
        throw new InvalidOperationException(
            "a public service needs --allow-origin: without it anyone who finds this address can drive " +
            "requests at third-party sites from your IP");
      case "none":
      case "proxy":
      case "ticket":
        break;
      default:
        throw new InvalidOperationException(
            $"--auth must be none, proxy, or ticket (got \"{Auth}\")");
    }

    ValidateListenAddress();

    if (MaxUploadBytes <= 0)
    {
      throw new InvalidOperationException(
          $"--max-upload must be a positive number of bytes (got {MaxUploadBytes}): " +
          "a zero cap refuses every upload");
    }

    if (HasStorage && !UnfurlDisabled && MaxUploadBytes > Array.MaxLength)
    {
      throw new InvalidOperationException(
          $"--max-upload must be no greater than {Array.MaxLength} bytes " +
          $"when remote URL upload is enabled (got {MaxUploadBytes})");
    }

    if (RateLimitPerMinute < 0)
    {
      throw new InvalidOperationException(
          $"--rate-limit must be zero or greater (got {RateLimitPerMinute})");
    }

    ValidateCollab();

    if (StorageDirectory != "" && S3Bucket == "")
    {
      LocalPublicPath = ParseLocalPublicPath();
    }

    if (S3Bucket == "")
    {
      return;
    }

    if (S3Endpoint == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs --s3-endpoint, e.g. https://s3.eu-central-1.amazonaws.com");
    }

    if (!Uri.TryCreate(S3Endpoint, UriKind.Absolute, out var endpoint) ||
        endpoint.Host == "" ||
        endpoint.UserInfo != "" ||
        endpoint.Query != "" ||
        endpoint.Fragment != "" ||
        endpoint.AbsolutePath.Trim('/') != "" ||
        (endpoint.Scheme != Uri.UriSchemeHttp && endpoint.Scheme != Uri.UriSchemeHttps))
    {
      throw new InvalidOperationException(
          $"--s3-endpoint must be a full HTTP(S) origin without credentials, a path, a query or a fragment (got \"{S3Endpoint}\")");
    }

    if (endpoint.Scheme == Uri.UriSchemeHttp &&
        !endpoint.IsLoopback)
    {
      throw new InvalidOperationException(
          $"--s3-endpoint must use HTTPS unless it targets loopback for local development (got \"{S3Endpoint}\")");
    }

    if (S3Region == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs --s3-region: an empty region is signed into every request and fails only at the first upload");
    }

    if (S3BucketUrl == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs --s3-bucket-url: it is the prefix stored URLs are built from, and the only prefix a delete is recognised under");
    }

    if (S3BucketUrl.IndexOfAny(['?', '#']) >= 0)
    {
      throw new InvalidOperationException(
          $"--s3-bucket-url must not contain a query or fragment (got \"{S3BucketUrl}\")");
    }

    if (HasMalformedPercentEscape(S3BucketUrl) ||
        ParseHttpUrl(S3BucketUrl) is null)
    {
      throw new InvalidOperationException(
          $"--s3-bucket-url must be a full HTTP(S) URL (got \"{S3BucketUrl}\")");
    }

    if (S3AccessKey == "" || S3SecretKey == "")
    {
      throw new InvalidOperationException(
          "--s3-bucket needs credentials in the BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY environment variables " +
          "(they are deliberately not flags: a flag lands in this machine's process list)");
    }

    if (S3Addressing is not ("" or "path" or "virtual"))
    {
      throw new InvalidOperationException(
          $"--s3-addressing must be \"path\" or \"virtual\", or empty to choose automatically (got \"{S3Addressing}\")");
    }
  }

  private void ValidateCollab()
  {
    if (CollabMaxConnectionsPerUserPerDoc <= 0)
    {
      throw new InvalidOperationException(
          $"CollabMaxConnectionsPerUserPerDoc must be a positive number (got {CollabMaxConnectionsPerUserPerDoc}): " +
          "a zero cap refuses every sync connection");
    }

    if (CollabMaxConnections < 0)
    {
      throw new InvalidOperationException(
          $"CollabMaxConnections must be zero (no ceiling) or greater (got {CollabMaxConnections})");
    }

    if (CollabMaxMessageBytes <= 0)
    {
      throw new InvalidOperationException(
          $"CollabMaxMessageBytes must be a positive number of bytes (got {CollabMaxMessageBytes}): " +
          "a zero cap closes every sync connection on its first frame");
    }

    if (CollabKeepAliveInterval < TimeSpan.Zero)
    {
      throw new InvalidOperationException(
          $"CollabKeepAliveInterval must be zero (off) or greater (got {CollabKeepAliveInterval})");
    }

    if (CollabInboundFramesPerSecond < 0)
    {
      throw new InvalidOperationException(
          $"CollabInboundFramesPerSecond must be zero (off) or greater (got {CollabInboundFramesPerSecond})");
    }

    if (CollabInboundBurstFrames <= 0)
    {
      throw new InvalidOperationException(
          $"CollabInboundBurstFrames must be a positive number of frames (got {CollabInboundBurstFrames}): " +
          "a zero burst closes every connection on its first frame");
    }

    if (CollabInboundResyncsPerMinute < 0)
    {
      throw new InvalidOperationException(
          $"CollabInboundResyncsPerMinute must be zero (off) or greater (got {CollabInboundResyncsPerMinute})");
    }

    if (CollabInboundAwarenessBytesPerSecond < 0)
    {
      throw new InvalidOperationException(
          "CollabInboundAwarenessBytesPerSecond must be zero (off) or greater " +
          $"(got {CollabInboundAwarenessBytesPerSecond})");
    }

    if (!CollabEnabled)
    {
      if (DocEndpoint != "")
      {
        throw new InvalidOperationException(
            "--doc-endpoint needs --collab: without it no sync room ever runs and the endpoint would be silently ignored");
      }

      if (CollabS3Prefix != "")
      {
        throw new InvalidOperationException(
            "--collab-s3-prefix needs --collab: without it no working set is ever written and the prefix would be silently ignored");
      }

      return;
    }

    if (DocEndpoint == "")
    {
      throw new InvalidOperationException(
          "--collab needs --doc-endpoint: sync rooms seed documents from it and export them back to it, " +
          "e.g. https://app.example.com/api/blok-docs");
    }

    if (!Uri.TryCreate(DocEndpoint, UriKind.Absolute, out var endpoint) ||
        endpoint.Host == "" ||
        endpoint.UserInfo != "" ||
        endpoint.Query != "" ||
        endpoint.Fragment != "" ||
        (endpoint.Scheme != Uri.UriSchemeHttp && endpoint.Scheme != Uri.UriSchemeHttps))
    {
      throw new InvalidOperationException(
          $"--doc-endpoint must be a full HTTP(S) URL without credentials, a query or a fragment (got \"{DocEndpoint}\")");
    }

    if (endpoint.Scheme == Uri.UriSchemeHttp && !endpoint.IsLoopback)
    {
      throw new InvalidOperationException(
          $"--doc-endpoint must use HTTPS unless it targets loopback for local development (got \"{DocEndpoint}\")");
    }

    if (DocEndpointAuth.AsSpan().IndexOfAny('\r', '\n') >= 0)
    {
      throw new InvalidOperationException(
          "--doc-endpoint-auth must not contain a line break (a trailing newline from `echo` or a file is " +
          "the usual cause): the header would be silently dropped from every doc-endpoint request");
    }

    if (CollabS3Prefix != "" && S3Bucket == "")
    {
      throw new InvalidOperationException(
          "--collab-s3-prefix needs --s3-bucket: the collaboration working set can only live in the bucket this server is configured for");
    }

    if (CollabDirectory == "" || StorageDirectory == "")
    {
      return;
    }

    var collabPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(CollabDirectory));
    var storagePath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(StorageDirectory));

    // Lexical only: symlinks or case-folding can still alias the two paths;
    // this guards a config mistake, not hostile input.
    if (collabPath == storagePath ||
        collabPath.StartsWith(storagePath + Path.DirectorySeparatorChar, StringComparison.Ordinal))
    {
      throw new InvalidOperationException(
          $"--collab-dir must not resolve inside --storage-dir (\"{CollabDirectory}\" is under \"{StorageDirectory}\"): " +
          "uploaded files are served publicly and the collaboration working set would be downloadable by anyone");
    }
  }

  private string ParseLocalPublicPath()
  {
    if (PublicUrl.IndexOfAny(['?', '#']) >= 0)
    {
      throw new InvalidOperationException(
          $"PublicUrl must not contain a query or fragment (got \"{PublicUrl}\")");
    }

    if (PublicUrl == "" || HasMalformedPercentEscape(PublicUrl))
    {
      throw new InvalidOperationException(
          $"PublicUrl must be an HTTP(S) URL or a root-relative path (got \"{PublicUrl}\")");
    }

    var absoluteUrl = ParseHttpUrl(PublicUrl);

    if (absoluteUrl is not null)
    {
      return absoluteUrl.AbsolutePath.TrimEnd('/');
    }

    if (!PublicUrl.StartsWith('/') ||
        PublicUrl.StartsWith("//", StringComparison.Ordinal) ||
        PublicUrl.Contains('\\') ||
        !Uri.TryCreate(PublicUrl, UriKind.Relative, out _))
    {
      throw new InvalidOperationException(
          $"PublicUrl must be an HTTP(S) URL or a root-relative path (got \"{PublicUrl}\")");
    }

    return PublicUrl == "/" ? "/" : PublicUrl.TrimEnd('/');
  }

  private static Uri? ParseHttpUrl(string value)
  {
    if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) ||
        parsed.Host == "" ||
        parsed.UserInfo != "" ||
        (parsed.Scheme != Uri.UriSchemeHttp &&
         parsed.Scheme != Uri.UriSchemeHttps))
    {
      return null;
    }

    return parsed;
  }

  private static bool HasMalformedPercentEscape(string value)
  {
    for (var index = 0; index < value.Length; index++)
    {
      if (value[index] != '%')
      {
        continue;
      }

      if (index + 2 >= value.Length ||
          !Uri.IsHexDigit(value[index + 1]) ||
          !Uri.IsHexDigit(value[index + 2]))
      {
        return true;
      }

      index += 2;
    }

    return false;
  }

  private void ValidateListenAddress()
  {
    string port;

    if (ListenAddress.StartsWith('['))
    {
      var bracket = ListenAddress.IndexOf(']');

      if (bracket < 0 ||
          bracket + 1 >= ListenAddress.Length ||
          ListenAddress[bracket + 1] != ':')
      {
        throw new InvalidOperationException(
            $"listen tcp: address {ListenAddress}: missing port in address");
      }

      port = ListenAddress[(bracket + 2)..];
    }
    else
    {
      var firstColon = ListenAddress.IndexOf(':');
      var lastColon = ListenAddress.LastIndexOf(':');

      if (lastColon < 0)
      {
        throw new InvalidOperationException(
            $"listen tcp: address {ListenAddress}: missing port in address");
      }

      if (firstColon != lastColon)
      {
        throw new InvalidOperationException(
            $"listen tcp: address {ListenAddress}: too many colons in address");
      }

      port = ListenAddress[(lastColon + 1)..];
    }

    if (port == "")
    {
      throw new InvalidOperationException(
          $"listen tcp: address {ListenAddress}: missing port in address");
    }

    if (!uint.TryParse(
          port,
          NumberStyles.None,
          CultureInfo.InvariantCulture,
          out var portNumber) ||
        portNumber > 65535)
    {
      throw new InvalidOperationException(
          $"listen tcp: address {port}: invalid port");
    }

    var host = ListenHost(ListenAddress);

    if (host != "" &&
        host is not ("*" or "+") &&
        !string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) &&
        !IPAddress.TryParse(host, out _))
    {
      throw new InvalidOperationException(
          $"listen tcp: DNS host \"{host}\" would bind every network interface; " +
          "use an IP address, localhost, or an explicit wildcard");
    }
  }

  private static bool IsLoopback(string listenAddress)
  {
    var host = ListenHost(listenAddress);

    if (host == "")
    {
      return false;
    }

    if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase))
    {
      return true;
    }

    if (!IPAddress.TryParse(host, out var address))
    {
      return false;
    }

    return IPAddress.IsLoopback(address) ||
        (address.IsIPv4MappedToIPv6 && IPAddress.IsLoopback(address.MapToIPv4()));
  }

  private static string BindScope(string listenAddress)
  {
    var host = ListenHost(listenAddress);

    if (host == "")
    {
      return " (an address with no host binds every network interface)";
    }

    return IPAddress.TryParse(host, out var address) &&
        (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any))
      ? " (which binds every network interface)"
      : "";
  }

  private static string ListenHost(string listenAddress)
  {
    if (listenAddress.StartsWith('['))
    {
      var bracket = listenAddress.IndexOf(']');

      if (bracket >= 0)
      {
        return listenAddress[1..bracket];
      }
    }

    var firstColon = listenAddress.IndexOf(':');
    var lastColon = listenAddress.LastIndexOf(':');

    if (firstColon >= 0 && firstColon == lastColon)
    {
      return listenAddress[..firstColon];
    }

    return listenAddress.Trim('[', ']').ToLowerInvariant();
  }
}
