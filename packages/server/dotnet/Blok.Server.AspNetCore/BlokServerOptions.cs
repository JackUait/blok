using System.Globalization;
using System.Net;

namespace Blok.Server.AspNetCore;

public sealed class BlokServerOptions
{
  private const long DefaultMaxUploadBytes = 32L << 20;

  public string Version { get; set; } = "dev";

  public string ListenAddress { get; set; } = "127.0.0.1:4000";

  public string Auth { get; set; } = "none";

  public string Secret { get; set; } = "";

  public IList<string> AllowedOrigins { get; set; } = [];

  public string StorageDirectory { get; set; } = "";

  public string PublicUrl { get; set; } = "";

  public long MaxUploadBytes { get; set; } = DefaultMaxUploadBytes;

  public long RateLimitPerMinute { get; set; }

  public bool UnfurlDisabled { get; set; } = true;

  public string S3Endpoint { get; set; } = "";

  public string S3Region { get; set; } = "";

  public string S3Bucket { get; set; } = "";

  public string S3BucketUrl { get; set; } = "";

  public string S3Addressing { get; set; } = "";

  public string S3AccessKey { get; set; } = "";

  public string S3SecretKey { get; set; } = "";

  public bool CollabEnabled { get; set; }

  public string DocEndpoint { get; set; } = "";

  public string DocEndpointAuth { get; set; } = "";

  public string CollabDirectory { get; set; } = "";

  public string CollabS3Prefix { get; set; } = "";

  public int CollabMaxConnectionsPerUserPerDoc { get; set; } = 8;

  /// <summary>
  /// Live sync connections the whole process may hold, everybody together
  /// (0 = no ceiling). Past it an upgrade is refused 503 BEFORE the room is
  /// seeded. Set it to the same number as Kestrel's
  /// MaxConcurrentUpgradedConnections: Kestrel's own refusal comes only after
  /// the seed, as a 500.
  /// </summary>
  public long CollabMaxConnections { get; set; }

  public int CollabMaxMessageBytes { get; set; } = 1 << 20;

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

  internal bool HasCollab => CollabEnabled;

  internal string LocalPublicPath { get; private set; } = "";

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
