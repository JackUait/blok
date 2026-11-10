using System.Net;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// The history hooks on <see cref="IBlokAuthorization"/>: who may read
/// history, how far back, and which lineages a DELETE must leave alone.
/// </summary>
public sealed partial class HistoryEndpointTests
{
  private static readonly JsonObject WindowFixture = JsonNode.Parse(File.ReadAllText(Path.Combine(
      OptionsValidateFixtureTests.RepositoryRoot(),
      "test/unit/server-conformance/fixtures/collab-history/window.json")))!.AsObject();

  /// <summary>Allows reads and writes; the history hooks answer from its switches.</summary>
  private sealed class HistoryPolicy : IBlokAuthorization
  {
    internal bool ReadHistory { get; set; } = true;

    /// <summary>Where the window should cut; the hook answers the span from now to it.</summary>
    internal DateTimeOffset? Cut { get; set; }

    internal HashSet<string> Held { get; } = [];

    internal List<string> HoldsAsked { get; } = [];

    public ValueTask<bool> CanReadDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(true);

    public ValueTask<bool> CanWriteDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(true);

    public ValueTask<bool> CanReadHistoryAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(ReadHistory);

    public ValueTask<TimeSpan?> HistoryWindowAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(Cut is { } cut ? DateTimeOffset.UtcNow - cut : (TimeSpan?)null);

    public ValueTask<bool> IsHistoryHeldAsync(string documentId, string lineage, CancellationToken cancellationToken = default)
    {
      HoldsAsked.Add(lineage);

      return ValueTask.FromResult(Held.Contains(lineage));
    }
  }

  /// <summary>Only the two gates: every history hook keeps its default.</summary>
  private sealed class PlainAuthorization : IBlokAuthorization
  {
    public ValueTask<bool> CanReadDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(true);

    public ValueTask<bool> CanWriteDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult(true);
  }

  [Fact]
  public async Task TheDefaultHooksReadEverythingWithNoWindowAndHoldNothing()
  {
    IBlokAuthorization plain = new PlainAuthorization();

    Assert.True(await plain.CanReadHistoryAsync(new ClaimsPrincipal(), "doc"));
    Assert.Null(await plain.HistoryWindowAsync(new ClaimsPrincipal(), "doc"));
    Assert.False(await plain.IsHistoryHeldAsync("doc", "lineage"));
  }

  [Fact]
  public async Task TheReadHookGuardsEveryRouteThatShowsHistory()
  {
    var policy = new HistoryPolicy { ReadHistory = false };
    await using var history = await HistoryApp.StartAsync(authorization: policy);
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");

    foreach (var (method, path) in new[]
    {
      (HttpMethod.Get, "/history"),
      (HttpMethod.Get, $"/history/{lineage}/1"),
      (HttpMethod.Get, $"/history/{lineage}/1/changes"),
      (HttpMethod.Get, "/history/at?time=2099-01-01T00:00:00Z"),
      (HttpMethod.Get, "/history/changes"),
      (HttpMethod.Post, $"/history/{lineage}/0/restore/preview"),
    })
    {
      using var response = await history.SendAsync(method, path);

      await AssertError(response, HttpStatusCode.Forbidden, "forbidden\n");
    }

    // A restore reads the version it writes, so the read hook guards it too: a writer it denies
    // cannot bring an old point back and then read it.
    using var restore = await history.RestoreAsync(lineage, "0", "denied");
    await AssertError(restore, HttpStatusCode.Forbidden, "forbidden\n");
    Assert.Contains("two", (await history.BlocksAsync()).ToJsonString());
  }

  [Fact]
  public async Task TheWindowHidesPointsBeforeItsCutOnEveryRoute()
  {
    var policy = new HistoryPolicy();
    await using var history = await HistoryApp.StartAsync(authorization: policy);
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");
    await history.EditTextAsync("three");
    await history.EditTextAsync("four");
    history.Journal.HeaderSpacing = TimeSpan.FromDays(1);
    // Records 1 and 2 are before the cut, 3 after it. The baseline is newer, but below a hidden record.
    policy.Cut = DateTimeOffset.UnixEpoch + TimeSpan.FromDays(2.5);
    var retention = WindowFixture["answers"]!["retention"]!;

    foreach (var (method, path) in new[]
    {
      (HttpMethod.Get, $"/history/{lineage}/2"),
      (HttpMethod.Get, $"/history/{lineage}/0"),
      (HttpMethod.Get, $"/history/{lineage}/2/changes"),
      (HttpMethod.Post, $"/history/{lineage}/2/restore/preview"),
      (HttpMethod.Get, "/history/at?time=1970-01-03T00:00:00Z"),
      (HttpMethod.Get, $"/history/changes?from=1970-01-01T00:00:00Z&before={lineage}:2"),
    })
    {
      using var response = await history.SendAsync(method, path);

      Assert.Equal((HttpStatusCode)retention["status"]!.GetValue<int>(), response.StatusCode);
      Assert.Equal(retention["contentType"]!.GetValue<string>(), response.Content.Headers.ContentType?.MediaType);
      Assert.Equal(retention["body"]!.GetValue<string>(), await response.Content.ReadAsStringAsync());
    }

    using var restore = await history.RestoreAsync(lineage, "2", "too-old");
    Assert.Equal(HttpStatusCode.NotFound, restore.StatusCode);
    Assert.Equal(retention["body"]!.GetValue<string>(), await restore.Content.ReadAsStringAsync());

    using var read = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/3");
    Assert.Equal(HttpStatusCode.OK, read.StatusCode);

    using var changes = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/3/changes");
    Assert.Equal(HttpStatusCode.OK, changes.StatusCode);
    var rows = JsonNode.Parse(await changes.Content.ReadAsStringAsync())!["changes"]!.AsArray();
    Assert.Equal([3UL], rows.Select(row => row!["sequence"]!.GetValue<ulong>()));

    using var list = await history.SendAsync(HttpMethod.Get, "/history?group=1");
    var versions = JsonNode.Parse(await list.Content.ReadAsStringAsync())!["versions"]!.AsArray();
    Assert.Equal([3UL], versions.Select(entry => entry!["sequence"]!.GetValue<ulong>()));

    using var range = await history.SendAsync(HttpMethod.Get, "/history/changes?from=1970-01-01T00:00:00Z");
    var ranged = JsonNode.Parse(await range.Content.ReadAsStringAsync())!["changes"]!.AsArray();
    Assert.Equal([3UL], ranged.Select(row => row!["sequence"]!.GetValue<ulong>()));

    using var at = await history.SendAsync(HttpMethod.Get, "/history/at?time=1970-01-05T00:00:00Z", accept: "application/json");
    Assert.Equal(HttpStatusCode.OK, at.StatusCode);
    Assert.Equal(3UL, JsonNode.Parse(await at.Content.ReadAsStringAsync())!["sequence"]!.GetValue<ulong>());

    // A window shrunk at runtime takes effect on the next call.
    policy.Cut = DateTimeOffset.UnixEpoch + TimeSpan.FromDays(3.5);
    using var shrunk = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/3");
    Assert.Equal(HttpStatusCode.NotFound, shrunk.StatusCode);
  }

  [Fact]
  public async Task AHeldLineageIsNotDeleted()
  {
    foreach (var entry in WindowFixture["delete"]!.AsArray())
    {
      var name = entry!["name"]!.GetValue<string>();
      var policy = new HistoryPolicy();
      await using var history = await HistoryApp.StartAsync(authorization: policy);
      var old = await history.OpenAsync();
      await history.ResetAsync();
      var current = await history.OpenAsync();
      var lineage = entry["lineage"]!.GetValue<string>() switch
      {
        "old" => old,
        "current" => current,
        _ => UnknownLineage,
      };

      if (entry["held"]!.GetValue<bool>())
      {
        policy.Held.Add(lineage);
      }

      using var response = await history.SendAsync(HttpMethod.Delete, $"/history/{lineage}");

      Assert.True((HttpStatusCode)entry["status"]!.GetValue<int>() == response.StatusCode, name);
      Assert.Equal(entry["body"]?.GetValue<string>() ?? "", await response.Content.ReadAsStringAsync());
      Assert.Equal([lineage], policy.HoldsAsked);

      if (entry["held"]!.GetValue<bool>())
      {
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
      }
    }
  }

  /// <summary>
  /// A group that straddles the cut shows only what the window shows: its startedAt and actors come from
  /// visible records, and a lineage whose baseline is hidden has no createdAt.
  /// </summary>
  [Fact]
  public async Task TheListShowsNothingOfAHiddenRecord()
  {
    var policy = new HistoryPolicy();
    await using var history = await HistoryApp.StartAsync(authorization: policy);
    await history.OpenAsync();
    await history.EditTextAsync("two");
    await history.EditTextAsync("three");
    await history.EditTextAsync("four");
    history.Journal.HeaderSpacing = TimeSpan.FromMinutes(1);
    // Records 1 to 3 land a minute apart, in one 15-minute group; the cut hides 1 and 2.
    policy.Cut = DateTimeOffset.UnixEpoch + TimeSpan.FromSeconds(150);

    using var list = await history.SendAsync(HttpMethod.Get, "/history?group=15");

    var body = JsonNode.Parse(await list.Content.ReadAsStringAsync())!;
    var version = Assert.Single(body["versions"]!.AsArray())!;
    Assert.Equal(3UL, version["sequence"]!.GetValue<ulong>());
    Assert.Equal(180_000L, version["startedAt"]!.GetValue<long>());
    Assert.Null(Assert.Single(body["lineages"]!.AsArray())!["createdAt"]);
  }
}
