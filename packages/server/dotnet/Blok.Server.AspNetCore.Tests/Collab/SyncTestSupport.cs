using System.Globalization;
using System.Net;
using System.Net.WebSockets;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

internal sealed record TicketFixture(
    [property: JsonPropertyName("secret")] string Secret,
    [property: JsonPropertyName("compatible")] string Compatible,
    [property: JsonPropertyName("docMismatch")] string DocMismatch,
    [property: JsonPropertyName("expired")] string Expired,
    [property: JsonPropertyName("malformed")] string Malformed,
    [property: JsonPropertyName("noncanonicalHeaderTicket")] string NoncanonicalHeaderTicket,
    [property: JsonPropertyName("readOnly")] string ReadOnly,
    [property: JsonPropertyName("tampered")] string Tampered,
    [property: JsonPropertyName("userTwo")] string UserTwo)
{
  internal static TicketFixture Load()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "tickets.json");
    var fixture = JsonSerializer.Deserialize<TicketFixture>(File.ReadAllText(path));

    return Assert.IsType<TicketFixture>(fixture);
  }

  /// <summary>A ticket the fixtures do not carry, signed with the fixture secret.</summary>
  internal string Sign(string payload)
  {
    const string header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
    var signingInput = $"{Base64Url(Encoding.UTF8.GetBytes(header))}." +
        $"{Base64Url(Encoding.UTF8.GetBytes(payload))}";
    var signature = HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(Secret),
        Encoding.UTF8.GetBytes(signingInput));

    return $"{signingInput}.{Base64Url(signature)}";
  }

  private static string Base64Url(byte[] value)
  {
    return Convert.ToBase64String(value)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
  }
}

/// <summary>Every wait in these tests carries this deadline (the .NET timing law).</summary>
internal static class Deadline
{
  internal static readonly TimeSpan Length = TimeSpan.FromSeconds(10);

  internal static CancellationToken Token()
  {
    return new CancellationTokenSource(Length).Token;
  }
}

/// <summary>
/// A clock the test drives. The inbound token buckets measure with
/// <see cref="TimeProvider.GetTimestamp"/>, so a frozen clock makes a burst
/// exact and <see cref="Advance"/> is the only thing that refills it.
/// </summary>
internal sealed class FakeClock : TimeProvider
{
  private static readonly DateTimeOffset Origin = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

  private long ticks;

  public override long TimestampFrequency => TimeSpan.TicksPerSecond;

  public override long GetTimestamp()
  {
    return Interlocked.Read(ref ticks);
  }

  public override DateTimeOffset GetUtcNow()
  {
    return Origin.AddTicks(GetTimestamp());
  }

  internal void Advance(TimeSpan delta)
  {
    Interlocked.Add(ref ticks, delta.Ticks);
  }
}

internal sealed record StoredWorkingSet(byte[] Frames, CollabWorkingSetTag Tag);

internal sealed class FakeWorkingSetStore : ICollabWorkingSetStore
{
  private readonly Dictionary<string, StoredWorkingSet> documents = new(StringComparer.Ordinal);

  internal StoredWorkingSet Stored(string docId)
  {
    lock (documents)
    {
      return documents[docId];
    }
  }

  public Task<CollabWorkingSet?> ReadAsync(string docId, CancellationToken cancellationToken = default)
  {
    lock (documents)
    {
      return Task.FromResult(documents.TryGetValue(docId, out var stored)
        ? new CollabWorkingSet(stored.Frames, stored.Tag)
        : null);
    }
  }

  public Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default)
  {
    lock (documents)
    {
      documents[docId] = new StoredWorkingSet(updates, tag);
    }

    return Task.CompletedTask;
  }

  public Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default)
  {
    lock (documents)
    {
      documents[docId] = new StoredWorkingSet([], newTag);
    }

    return Task.CompletedTask;
  }
}

internal sealed class FakeDocEndpoint : IDocEndpointClient
{
  private readonly Dictionary<string, LoadedDocument> documents = new(StringComparer.Ordinal);

  internal Exception? LoadFailure { get; set; }

  internal void Holds(string docId, string text)
  {
    documents[docId] = new LoadedDocument(new JsonObject { ["text"] = text }, null);
  }

  public Task<LoadedDocument> LoadAsync(string docId, CancellationToken cancellationToken)
  {
    if (LoadFailure is not null)
    {
      throw LoadFailure;
    }

    return Task.FromResult(documents.TryGetValue(docId, out var loaded)
      ? loaded
      : new LoadedDocument(null, null));
  }

  public Task<string?> SaveAsync(
      string docId,
      JsonNode outputData,
      string? version,
      CancellationToken cancellationToken)
  {
    return Task.FromResult<string?>(null);
  }
}

/// <summary>Stand-in for YDocConverter over one "content" text root and a {"text": ...} shape.</summary>
internal sealed class FakeDocConverter : ICollabDocConverter
{
  public void Seed(YDoc doc, JsonNode outputData)
  {
    var text = doc.GetText("content");

    doc.Transact(transaction =>
        text.Insert(transaction, 0, outputData["text"]?.GetValue<string>() ?? ""));
  }

  /// <summary>
  /// Enough of the real op semantics for the endpoint's sake: an insert
  /// appends its text, an update replaces the whole root, a remove empties it.
  /// The real block laws are the converter's own tests; here the point is that
  /// a write reaches the doc, the log and the members.
  /// </summary>
  public void ApplyOps(YDoc doc, IReadOnlyList<CollabEditOp> ops)
  {
    var text = doc.GetText("content");

    foreach (var op in ops)
    {
      doc.Transact(transaction =>
      {
        switch (op)
        {
          case CollabEditOp.Insert insert:
            text.Insert(
                transaction,
                text.ToString().Length,
                insert.Block["data"]?["text"]?.GetValue<string>() ?? "");

            break;

          case CollabEditOp.Update update:
            text.Delete(transaction, 0, text.ToString().Length);
            text.Insert(transaction, 0, update.Data["text"]?.GetValue<string>() ?? "");

            break;

          default:
            text.Delete(transaction, 0, text.ToString().Length);

            break;
        }
      });
    }
  }

  public JsonNode Export(YDoc doc)
  {
    return new JsonObject { ["text"] = YDocs.Text(doc) };
  }
}

/// <summary>Client-side Yjs helpers over the same "content" text root.</summary>
internal static class YDocs
{
  private static long nextClientId = 2_000_000;

  /// <summary>Unique client ids: yjs drops a repeated (client, clock) pair.</summary>
  internal static YDoc NewClient()
  {
    return new YDoc((uint)Interlocked.Increment(ref nextClientId));
  }

  internal static byte[] UpdateAppending(YDoc doc, string value)
  {
    var text = doc.GetText("content");

    return doc.Transact(
            transaction => text.Insert(transaction, text.ToString().Length, value)) ??
        throw new InvalidOperationException("no update was emitted");
  }

  internal static byte[] StateVector(YDoc doc)
  {
    return doc.EncodeStateVector();
  }

  internal static void Apply(YDoc doc, byte[] update)
  {
    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
  }

  internal static string Text(YDoc doc)
  {
    return doc.GetText("content").ToString();
  }
}

/// <summary>One test client on the sync socket: encodes/decodes SyncWire frames with deadlines.</summary>
internal sealed class SyncClient(WebSocket socket) : IAsyncDisposable
{
  private readonly byte[] buffer = new byte[64 * 1024];

  internal WebSocket Socket => socket;

  internal string? SubProtocol => socket.SubProtocol;

  internal Task SendAsync(SyncWireMessage message)
  {
    return SendRawAsync(SyncWire.Encode(message));
  }

  internal Task SendRawAsync(byte[] frame)
  {
    return socket.SendAsync(
        new ArraySegment<byte>(frame),
        WebSocketMessageType.Binary,
        endOfMessage: true,
        Deadline.Token());
  }

  internal async Task<SyncWireMessage> ReceiveAsync()
  {
    var (type, payload) = await ReceiveRawAsync();

    if (type == WebSocketMessageType.Close)
    {
      Assert.Fail(
          $"expected a frame but the socket closed with {(int?)socket.CloseStatus} " +
          $"\"{socket.CloseStatusDescription}\"");
    }

    Assert.True(SyncWire.TryDecode(payload, out var message, out var error), error);

    return message;
  }

  /// <summary>
  /// The next frame of type <typeparamref name="T"/>. Join-time queryAwareness
  /// broadcasts from other members are skipped unless that is what is asked
  /// for — they may land between any two frames.
  /// </summary>
  internal async Task<T> ReceiveAsync<T>() where T : SyncWireMessage
  {
    while (true)
    {
      var message = await ReceiveAsync();

      if (message is QueryAwarenessFrame && typeof(T) != typeof(QueryAwarenessFrame))
      {
        continue;
      }

      return Assert.IsType<T>(message);
    }
  }

  /// <summary>
  /// Skips data frames still in flight and returns the close the server sent.
  /// <paramref name="answer"/> false leaves the server's close unanswered —
  /// how a client that has stopped talking behaves.
  /// </summary>
  internal async Task<(int Status, string Description)> ReceiveCloseAsync(bool answer = true)
  {
    while (true)
    {
      var (type, _) = await ReceiveRawAsync();

      if (type != WebSocketMessageType.Close)
      {
        continue;
      }

      if (answer && socket.State == WebSocketState.CloseReceived)
      {
        await socket.CloseOutputAsync(
            WebSocketCloseStatus.NormalClosure,
            "",
            Deadline.Token());
      }

      return ((int)(socket.CloseStatus ?? WebSocketCloseStatus.Empty), socket.CloseStatusDescription ?? "");
    }
  }

  internal Task CloseAsync()
  {
    return socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", Deadline.Token());
  }

  public ValueTask DisposeAsync()
  {
    socket.Dispose();

    return ValueTask.CompletedTask;
  }

  private async Task<(WebSocketMessageType Type, byte[] Payload)> ReceiveRawAsync()
  {
    using var payload = new MemoryStream();
    var token = Deadline.Token();

    while (true)
    {
      var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);

      if (result.MessageType == WebSocketMessageType.Close)
      {
        return (result.MessageType, []);
      }

      payload.Write(buffer, 0, result.Count);

      if (result.EndOfMessage)
      {
        return (result.MessageType, payload.ToArray());
      }
    }
  }
}

/// <summary>Thrown by <see cref="SyncApp.ConnectAsync"/> when the server refused the upgrade.</summary>
internal sealed class UpgradeRefusedException(int statusCode) : Exception($"upgrade refused with {statusCode}")
{
  internal int StatusCode { get; } = statusCode;
}

/// <summary>
/// A TestServer-hosted Blok server with collaboration on and the room
/// manager built from in-memory fakes (the DI factory would need a real doc
/// endpoint). The FakeDocEndpoint holds <see cref="Doc"/> as "seeded".
/// </summary>
internal sealed class SyncApp : IAsyncDisposable
{
  internal const string AllowedOrigin = "https://app.example.com";
  internal const string Doc = "doc-42";
  internal const string Protocol = "blok-sync.v1";

  private readonly WebApplication app;
  private readonly string pattern;

  private SyncApp(WebApplication app, string pattern, SyncFakes fakes)
  {
    this.app = app;
    this.pattern = pattern;
    Fakes = fakes;
  }

  internal SyncFakes Fakes { get; }

  internal WebApplication App => app;

  internal static async Task<SyncApp> StartAsync(
      string auth = "none",
      Action<BlokServerOptions>? configure = null,
      Action<IServiceCollection>? services = null,
      Action<WebApplication>? configureApp = null,
      string pattern = "",
      bool requireAuthorization = false,
      SyncFakes? fakes = null)
  {
    fakes ??= new SyncFakes();
    var fixture = TicketFixture.Load();
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddSingleton(fakes.Manager);
    builder.Services.AddBlokServer(options =>
    {
      options.Auth = auth;
      options.Secret = auth == "ticket" ? fixture.Secret : "";
      options.AllowedOrigins = [AllowedOrigin];
      options.CollabEnabled = true;
      options.DocEndpoint = "https://app.example.com/api/blok-docs";
      options.CollabDirectory = Path.Combine(
          Path.GetTempPath(),
          $"blok-sync-tests-{Guid.NewGuid():N}");
      configure?.Invoke(options);
    });
    services?.Invoke(builder.Services);

    var app = builder.Build();
    configureApp?.Invoke(app);
    var routes = app.MapBlokServer(pattern);

    if (requireAuthorization)
    {
      routes.RequireAuthorization();
    }

    await app.StartAsync();

    return new SyncApp(app, pattern, fakes);
  }

  internal HttpClient CreateClient()
  {
    return app.GetTestClient();
  }

  /// <summary>Opens a socket; a refused upgrade surfaces as <see cref="UpgradeRefusedException"/>.</summary>
  internal async Task<SyncClient> ConnectAsync(
      string doc = Doc,
      IEnumerable<string>? protocols = null,
      string? origin = AllowedOrigin,
      Action<HttpRequest>? configure = null)
  {
    var client = app.GetTestServer().CreateWebSocketClient();

    foreach (var protocol in protocols ?? [])
    {
      client.SubProtocols.Add(protocol);
    }

    client.ConfigureRequest = request =>
    {
      if (origin is not null)
      {
        request.Headers.Origin = origin;
      }

      configure?.Invoke(request);
    };

    try
    {
      var socket = await client.ConnectAsync(
          new Uri($"ws://localhost{pattern}/sync/{Uri.EscapeDataString(doc)}"),
          Deadline.Token());

      return new SyncClient(socket);
    }
    catch (InvalidOperationException error) when (
        Regex.Match(error.Message, @"\d{3}") is { Success: true } status)
    {
      throw new UpgradeRefusedException(
          int.Parse(status.Value, CultureInfo.InvariantCulture));
    }
  }

  /// <summary>Connects and asserts the upgrade was refused with <paramref name="status"/>.</summary>
  internal async Task AssertRefusedAsync(
      HttpStatusCode status,
      string doc = Doc,
      IEnumerable<string>? protocols = null,
      string? origin = AllowedOrigin,
      Action<HttpRequest>? configure = null)
  {
    var refused = await Assert.ThrowsAsync<UpgradeRefusedException>(() =>
        ConnectAsync(doc, protocols, origin, configure));

    Assert.Equal((int)status, refused.StatusCode);
  }

  /// <summary>Connects with the ticket-mode offer [blok-sync.v1, ticket] as repeated header values.</summary>
  internal Task<SyncClient> ConnectWithTicketAsync(string ticket, string doc = Doc)
  {
    return ConnectAsync(doc, [Protocol, ticket]);
  }

  public async ValueTask DisposeAsync()
  {
    await app.DisposeAsync();
  }
}

internal sealed class SyncFakes
{
  internal FakeWorkingSetStore Store { get; } = new();

  internal FakeDocEndpoint Endpoint { get; } = new();

  internal FakeDocConverter Converter { get; } = new();

  internal CollabRoomManager Manager { get; }

  internal SyncFakes(CollabRoomOptions? roomOptions = null)
  {
    Endpoint.Holds(SyncApp.Doc, "seeded");
    Manager = new CollabRoomManager(
        Store,
        Endpoint,
        Converter,
        roomOptions ?? new CollabRoomOptions(),
        TimeProvider.System);
  }
}

/// <summary>Authenticates any request carrying X-Test-User; the header value is the user id.</summary>
internal sealed class HeaderAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(
        options,
        logger,
        encoder)
{
  internal const string SchemeName = "test";
  internal const string Header = "X-Test-User";

  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    var user = Request.Headers[Header].ToString();

    if (user.Length == 0)
    {
      return Task.FromResult(AuthenticateResult.NoResult());
    }

    var identity = new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, user)],
        Scheme.Name);
    var principal = new ClaimsPrincipal(identity);

    return Task.FromResult(
        AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
  }
}

internal sealed class RecordingAuthorization : IBlokAuthorization
{
  internal bool AllowRead { get; set; } = true;

  internal bool AllowWrite { get; set; } = true;

  internal List<(string Method, string User, string Document)> Calls { get; } = [];

  /// <summary>Every principal the hook was handed, in call order.</summary>
  internal List<ClaimsPrincipal> Principals { get; } = [];

  public ValueTask<bool> CanReadDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default)
  {
    Record("read", user, documentId);

    return ValueTask.FromResult(AllowRead);
  }

  public ValueTask<bool> CanWriteDocumentAsync(
      ClaimsPrincipal user,
      string documentId,
      CancellationToken cancellationToken = default)
  {
    Record("write", user, documentId);

    return ValueTask.FromResult(AllowWrite);
  }

  private void Record(string method, ClaimsPrincipal user, string documentId)
  {
    lock (Calls)
    {
      Calls.Add((
          method,
          user.Identity?.Name ?? user.FindFirstValue(ClaimTypes.NameIdentifier) ?? "",
          documentId));
      Principals.Add(user);
    }
  }
}
