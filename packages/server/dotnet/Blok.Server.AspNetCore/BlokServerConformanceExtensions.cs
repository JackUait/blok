#if BLOK_SERVER_CONFORMANCE
using System.Net;
using Blok.Server.Collab;
using Blok.Server.Outbound;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Blok.Server.AspNetCore;

/// <summary>
/// Substitutions the conformance runner needs and a shipped server must not
/// have. The whole file compiles only under <c>BLOK_SERVER_CONFORMANCE</c>, so
/// none of it is in a released assembly.
/// </summary>
public static class BlokServerConformanceExtensions
{
  /// <summary>
  /// Puts the built-in journal behind this server, which production DI never
  /// does: <see cref="LocalCollabOperationStore"/> is Blok.Server-internal and
  /// no host flag reaches it, so a stock host negotiates blok-sync.v1 and
  /// journals nothing. The conformance suite needs a real process that
  /// journals to prove hard-kill recovery from outside it.
  /// </summary>
  /// <param name="builder">The server being built.</param>
  /// <param name="directory">
  /// The collaboration directory. The store puts each document under
  /// <c>&lt;directory&gt;/&lt;key&gt;.journal/</c>, beside the working set.
  /// </param>
  /// <returns>The same builder, so hooks chain.</returns>
  public static BlokServerBuilder UseConformanceJournal(
      this BlokServerBuilder builder,
      string directory)
  {
    ArgumentNullException.ThrowIfNull(builder);
    ArgumentException.ThrowIfNullOrEmpty(directory);

    builder.Services.RemoveAll<ICollabOperationStore>();
    builder.Services.AddSingleton<ICollabOperationStore>(
        new LocalCollabOperationStore(directory));

    return builder;
  }

  /// <summary>
  /// Narrows outbound fetches to one loopback origin. The shipped policy
  /// blocks loopback outright, which is exactly what an unfurl test needs to
  /// reach.
  /// </summary>
  /// <param name="builder">The server being built.</param>
  /// <param name="origin">
  /// The only URL prefix allowed. Matched as a prefix that must end at a
  /// <c>/</c>, <c>?</c> or <c>#</c>, so a sibling path cannot pass by sharing
  /// its opening characters.
  /// </param>
  /// <param name="port">The loopback port the fixture server is on.</param>
  /// <returns>The same builder, so hooks chain.</returns>
  public static BlokServerBuilder UseConformanceOrigin(
      this BlokServerBuilder builder,
      string origin,
      int port)
  {
    ArgumentNullException.ThrowIfNull(builder);
    ArgumentNullException.ThrowIfNull(origin);

    builder.Services.RemoveAll<IGuardedOutboundPolicy>();
    builder.Services.AddSingleton<IGuardedOutboundPolicy>(
        new ExactOriginOutboundPolicy(origin, port));

    return builder;
  }

  private sealed class ExactOriginOutboundPolicy(
      string origin,
      int port) : IGuardedOutboundPolicy
  {
    public GuardedTarget Validate(
        string rawUrl,
        Uri? baseUrl = null)
    {
      var parsed = baseUrl is null
        ? Uri.TryCreate(rawUrl, UriKind.Absolute, out var url)
        : Uri.TryCreate(baseUrl, rawUrl, out url);

      if (!parsed ||
          url is null ||
          url.Scheme != Uri.UriSchemeHttp ||
          url.Host != "127.0.0.1" ||
          url.Port != port ||
          url.UserInfo != "" ||
          !HasExactOrigin(url))
      {
        throw Blocked();
      }

      return new GuardedTarget(
          url,
          "127.0.0.1",
          port,
          IPAddress.Loopback);
    }

    public bool IsAddressAllowed(IPAddress address)
    {
      return address.Equals(IPAddress.Loopback);
    }

    private bool HasExactOrigin(Uri url)
    {
      var value = url.OriginalString.AsSpan();
      return value.StartsWith(
            origin,
            StringComparison.Ordinal) &&
          (value.Length == origin.Length ||
           value[origin.Length] is '/' or '?' or '#');
    }

    private static GuardedFetchException Blocked()
    {
      return new GuardedFetchException(
          GuardedFetchFailure.BlockedDestination);
    }
  }
}
#endif
