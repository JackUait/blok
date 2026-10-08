using System.Collections.Concurrent;
using System.Net;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tickets;
using Blok.Server.Yjs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// The five history routes: list, read, delete and restore versions kept by
/// the operation journal, and list the edits inside one. Runs on the real converter and the local journal.
/// </summary>
public sealed class HistoryEndpointTests
{
  private const string UnknownLineage = "ffffffffffffffffffffffffffffffff";

  // Loading the runtime bundle costs about a second; one per test process.
  private static readonly Lazy<IRichTextHtmlReader> Reader = new(
      () => new RuntimeRichTextHtmlReader(JintBlokRuntime.FromEmbeddedResource(poolSize: 2)));

  private readonly TicketFixture fixture = TicketFixture.Load();

  [Fact]
  public async Task TheListNamesEveryLineageAndItsVersions()
  {
    await using var history = await HistoryApp.StartAsync(auth: "ticket");
    var first = await history.OpenAsync(fixture.Compatible);
    await history.EditTextAsync("two", fixture.Compatible);
    await history.ResetAsync(fixture.Compatible);
    var second = await history.OpenAsync(fixture.Compatible);

    using var response = await history.SendAsync(HttpMethod.Get, "/history", fixture.Compatible);

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
    Assert.Equal(["lineages", "versions"], body.Select(member => member.Key));

    var lineages = body["lineages"]!.AsArray();
    Assert.Equal([first, second], lineages.Select(entry => entry!["lineage"]!.GetValue<string>()));
    Assert.Equal([false, true], lineages.Select(entry => entry!["current"]!.GetValue<bool>()));
    var lineage = lineages[0]!.AsObject();
    Assert.Equal(["lineage", "epoch", "format", "createdAt", "current"], lineage.Select(member => member.Key));
    Assert.True(lineage["epoch"]!.GetValue<long>() >= 0);
    Assert.Equal(CollabWorkingSetTag.CurrentFormat, lineage["format"]!.GetValue<int>());
    AssertUnixMilliseconds(lineage["createdAt"]);

    var versions = body["versions"]!.AsArray();
    Assert.Equal(
        [(second, 0UL), (first, 1UL), (first, 0UL)],
        versions.Select(entry => (entry!["lineage"]!.GetValue<string>(), entry["sequence"]!.GetValue<ulong>())));
    var edited = versions[1]!.AsObject();
    Assert.Equal(["lineage", "sequence", "startedAt", "savedAt", "actors"], edited.Select(member => member.Key));
    AssertUnixMilliseconds(edited["startedAt"]);
    AssertUnixMilliseconds(edited["savedAt"]);
    Assert.Equal(["u1"], edited["actors"]!.AsArray().Select(actor => actor!.GetValue<string>()));
  }

  [Fact]
  public async Task TheGroupQueryChoosesTheGroupingWindow()
  {
    await using var history = await HistoryApp.StartAsync();
    await history.OpenAsync();
    await history.EditTextAsync("two");
    await history.EditTextAsync("three");
    history.Journal.HeaderSpacing = TimeSpan.FromSeconds(90);

    async Task<IEnumerable<ulong>> SequencesAsync(string query)
    {
      using var response = await history.SendAsync(HttpMethod.Get, $"/history{query}");

      Assert.Equal(HttpStatusCode.OK, response.StatusCode);
      var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

      return body["versions"]!.AsArray().Select(entry => entry!["sequence"]!.GetValue<ulong>()).ToList();
    }

    Assert.Equal([2UL, 0UL], await SequencesAsync(""));
    Assert.Equal([2UL, 1UL, 0UL], await SequencesAsync("?group=1"));
    Assert.Equal([2UL, 0UL], await SequencesAsync("?group=15"));
    Assert.Equal([2UL, 0UL], await SequencesAsync("?group=60"));
  }

  [Theory]
  [InlineData("?group=")]
  [InlineData("?group=0")]
  [InlineData("?group=5")]
  [InlineData("?group=-1")]
  [InlineData("?group=%2B1")]
  [InlineData("?group=%201")]
  [InlineData("?group=one")]
  [InlineData("?group=1&group=1")]
  public async Task AGroupOtherThanOneFifteenOrSixtyIsABadRequest(string query)
  {
    await using var history = await HistoryApp.StartAsync();
    await history.OpenAsync();

    using var response = await history.SendAsync(HttpMethod.Get, $"/history{query}");

    await AssertError(response, HttpStatusCode.BadRequest, "group must be 1, 15 or 60\n");
    Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
  }

  [Fact]
  public async Task AReadServesTheVersionWithItsPointAndNoEntityTag()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    var atZero = await history.BlocksAsync();
    await history.EditTextAsync("two");

    using var response = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    Assert.Equal(lineage, Assert.Single(response.Headers.GetValues("Blok-History-Lineage")));
    Assert.Equal("0", Assert.Single(response.Headers.GetValues("Blok-History-Sequence")));
    Assert.False(response.Headers.Contains("ETag"));
    Assert.False(response.Headers.Contains("Blok-Doc-Lineage"));
    Assert.False(response.Headers.Contains("Blok-Doc-Sequence"));
    var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    Assert.True(JsonNode.DeepEquals(atZero, body["blocks"]), $"{body["blocks"]}");
    AssertUnixMilliseconds(body["time"]);
    Assert.False(body.AsObject().ContainsKey("page"));
    Assert.False(body.AsObject().ContainsKey("values"));
  }

  /// <summary>Only plain JSON keys: a nested shared type or undefined has no copy, as in a restore.</summary>
  [Fact]
  public async Task AReadCarriesThePlainKeysOfThePageAndValuesMaps()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await using var member = await history.App.ConnectAsync(protocols: [SyncApp.Protocol]);
    await member.ReceiveAsync<BlokControlFrame>();
    var mirror = YDocs.NewClient();
    await member.SendAsync(new SyncStep1Frame(YDocs.StateVector(mirror)));
    YDocs.Apply(mirror, (await member.ReceiveAsync<SyncStep2Frame>()).Update);
    await member.ReceiveAsync<SyncStep1Frame>();

    var update = mirror.Transact(transaction =>
    {
      mirror.GetMap("page").Set(transaction, "title", "Plan");
      mirror.GetMap("values").Set(transaction, "title", "Old title");
      mirror.GetMap("values").Set(transaction, "nested", new YMap());
      mirror.GetMap("values").Set(transaction, "gone", YUndefined.Instance);
    })!;
    await member.SendAsync(new SyncUpdateFrame(update));
    await history.WaitForSequenceAsync(1);

    using var response = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/1");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    Assert.Equal("""{"title":"Plan"}""", body["page"]!.ToJsonString());
    Assert.Equal("""{"title":"Old title"}""", body["values"]!.ToJsonString());
  }

  /// <summary>Not Blok-Doc-*: those name the live head. A browser host still has to read them.</summary>
  [Fact]
  public async Task ACrossOriginPageCanReadTheHistoryHeaders()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();

    using var response = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");

    Assert.Equal(SyncApp.AllowedOrigin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    Assert.Equal(
        ["Blok-History-Lineage", "Blok-History-Sequence"],
        Assert.Single(response.Headers.GetValues("Access-Control-Expose-Headers"))
            .Split(',', StringSplitOptions.TrimEntries)
            .Order(StringComparer.Ordinal));
  }

  [Fact]
  public async Task AReadOfAnUnknownPointIsNotFound()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");

    using var pastHead = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/2");
    using var unknown = await history.SendAsync(HttpMethod.Get, $"/history/{UnknownLineage}/0");

    Assert.Equal(HttpStatusCode.NotFound, pastHead.StatusCode);
    Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    Assert.Equal("no-store", pastHead.Headers.CacheControl?.ToString());
  }

  [Theory]
  [InlineData("one")]
  [InlineData("-1")]
  [InlineData("%2B1")]
  [InlineData("18446744073709551616")]
  public async Task ASequenceThatIsNotAnUnsignedLongIsABadRequest(string sequence)
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();

    using var read = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/{sequence}");
    using var restore = await history.RestoreAsync(lineage, sequence, "bad-sequence");

    Assert.Equal(HttpStatusCode.BadRequest, read.StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, restore.StatusCode);
  }

  [Fact]
  public async Task ChangesListEachRecordsEditsOldestFirst()
  {
    await using var history = await HistoryApp.StartAsync(auth: "ticket");
    var lineage = await history.OpenAsync(fixture.Compatible);
    var atZero = await history.BlocksAsync(fixture.Compatible);
    await history.EditTextAsync("two", fixture.Compatible);
    await history.EditAsync(
        Guid.NewGuid().ToString("N"),
        """{ "ops": [ { "op": "insert", "id": "b", "after": "a", "block": { "type": "header", "data": { "text": "h", "level": 2 } } } ] }""",
        fixture.Compatible);
    var atTwo = await history.BlocksAsync(fixture.Compatible);

    using var response = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/2/changes", fixture.Compatible);
    using var since = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/2/changes?since=1", fixture.Compatible);

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    Assert.Equal(lineage, Assert.Single(response.Headers.GetValues("Blok-History-Lineage")));
    Assert.Equal("2", Assert.Single(response.Headers.GetValues("Blok-History-Sequence")));
    var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
    Assert.Equal(["changes"], body.Select(member => member.Key));
    var changes = body["changes"]!.AsArray();
    Assert.Equal([1UL, 2UL], changes.Select(entry => entry!["sequence"]!.GetValue<ulong>()));

    var first = changes[0]!.AsObject();
    Assert.Equal(["sequence", "committedAt", "actor", "blocks"], first.Select(member => member.Key));
    AssertUnixMilliseconds(first["committedAt"]);
    Assert.Equal("u1", first["actor"]!.GetValue<string>());
    var changed = Assert.Single(first["blocks"]!.AsArray())!.AsObject();
    Assert.Equal(["id", "type", "kind", "before", "after"], changed.Select(member => member.Key));
    Assert.Equal(("a", "paragraph", "changed"), (
        changed["id"]!.GetValue<string>(),
        changed["type"]!.GetValue<string>(),
        changed["kind"]!.GetValue<string>()));
    Assert.True(JsonNode.DeepEquals(atZero[0], changed["before"]), $"{changed["before"]}");

    var added = Assert.Single(changes[1]!["blocks"]!.AsArray())!.AsObject();
    Assert.Equal(["id", "type", "kind", "after"], added.Select(member => member.Key));
    Assert.Equal(("b", "header", "added"), (
        added["id"]!.GetValue<string>(),
        added["type"]!.GetValue<string>(),
        added["kind"]!.GetValue<string>()));
    Assert.True(JsonNode.DeepEquals(atTwo[1], added["after"]), $"{added["after"]}");

    Assert.Equal(HttpStatusCode.OK, since.StatusCode);
    var sinceChanges = JsonNode.Parse(await since.Content.ReadAsStringAsync())!["changes"]!.AsArray();
    Assert.Equal([2UL], sinceChanges.Select(entry => entry!["sequence"]!.GetValue<ulong>()));
  }

  [Fact]
  public async Task ChangesNamePageKeysOnlyForARecordThatChangedThem()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await using var member = await history.App.ConnectAsync(protocols: [SyncApp.Protocol]);
    await member.ReceiveAsync<BlokControlFrame>();
    var mirror = YDocs.NewClient();
    await member.SendAsync(new SyncStep1Frame(YDocs.StateVector(mirror)));
    YDocs.Apply(mirror, (await member.ReceiveAsync<SyncStep2Frame>()).Update);
    await member.ReceiveAsync<SyncStep1Frame>();

    var update = mirror.Transact(transaction =>
    {
      mirror.GetMap("page").Set(transaction, "title", "Plan");
      mirror.GetMap("values").Set(transaction, "k", 1.0);
    })!;
    await member.SendAsync(new SyncUpdateFrame(update));
    await history.WaitForSequenceAsync(1);
    await history.EditTextAsync("two");

    using var response = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/2/changes");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    var changes = JsonNode.Parse(await response.Content.ReadAsStringAsync())!["changes"]!.AsArray();
    Assert.Equal("""["title","values.k"]""", changes[0]!["page"]!.ToJsonString());
    Assert.Empty(changes[0]!["blocks"]!.AsArray());
    Assert.False(changes[1]!.AsObject().ContainsKey("page"));
  }

  /// <summary>A block that is one record's after and the next one's before is written into both rows.</summary>
  [Fact]
  public async Task ABlockChangedInTwoRecordsInARowReadsTheSameInBoth()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");
    var atOne = await history.BlocksAsync();
    await history.EditTextAsync("three");
    var atTwo = await history.BlocksAsync();

    using var response = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/2/changes");

    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    var changes = JsonNode.Parse(await response.Content.ReadAsStringAsync())!["changes"]!.AsArray();
    Assert.True(JsonNode.DeepEquals(atOne[0], changes[0]!["blocks"]![0]!["after"]), $"{changes[0]}");
    Assert.True(JsonNode.DeepEquals(atOne[0], changes[1]!["blocks"]![0]!["before"]), $"{changes[1]}");
    Assert.True(JsonNode.DeepEquals(atTwo[0], changes[1]!["blocks"]![0]!["after"]), $"{changes[1]}");
  }

  [Fact]
  public async Task ChangesPastTheCapAreTheNewestAndSayTruncated()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();

    for (var edit = 1; edit <= CollabRoomManager.MaxChangeRecords + 1; edit++)
    {
      await history.EditTextAsync($"v{edit}");
    }

    using var atCap = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/{CollabRoomManager.MaxChangeRecords}/changes");
    using var overCap = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/{CollabRoomManager.MaxChangeRecords + 1}/changes");

    var under = JsonNode.Parse(await atCap.Content.ReadAsStringAsync())!.AsObject();
    Assert.False(under.ContainsKey("truncated"));
    Assert.Equal(CollabRoomManager.MaxChangeRecords, under["changes"]!.AsArray().Count);
    var over = JsonNode.Parse(await overCap.Content.ReadAsStringAsync())!.AsObject();
    Assert.True(over["truncated"]!.GetValue<bool>());
    var rows = over["changes"]!.AsArray();
    Assert.Equal(CollabRoomManager.MaxChangeRecords, rows.Count);
    Assert.Equal(2UL, rows[0]!["sequence"]!.GetValue<ulong>());
    Assert.Equal("""[{"text":"v1"}]""", rows[0]!["blocks"]![0]!["before"]!["data"]!["text"]!.ToJsonString());
  }

  [Fact]
  public async Task ChangesOfTheBaselineAreEmptyAndAnUnknownPointIsNotFound()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");

    using var baseline = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0/changes");
    using var pastHead = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/2/changes");
    using var unknown = await history.SendAsync(HttpMethod.Get, $"/history/{UnknownLineage}/0/changes");

    Assert.Equal(HttpStatusCode.OK, baseline.StatusCode);
    Assert.Equal("""{"changes":[]}""", await baseline.Content.ReadAsStringAsync());
    await AssertError(pastHead, HttpStatusCode.NotFound, "no such version\n");
    await AssertError(unknown, HttpStatusCode.NotFound, "no such version\n");
  }

  [Theory]
  [InlineData("1/changes?since=2")]
  [InlineData("1/changes?since=")]
  [InlineData("1/changes?since=-1")]
  [InlineData("1/changes?since=%2B1")]
  [InlineData("1/changes?since=one")]
  [InlineData("1/changes?since=0&since=0")]
  [InlineData("one/changes")]
  public async Task ChangesWithABadSinceOrSequenceAreABadRequest(string path)
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");

    using var response = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/{path}");

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
  }

  [Fact]
  public async Task ADeleteRemovesAnOldLineageAndRefusesTheCurrentOne()
  {
    await using var history = await HistoryApp.StartAsync();
    var old = await history.OpenAsync();
    await history.ResetAsync();
    var current = await history.OpenAsync();

    using var deleted = await history.SendAsync(HttpMethod.Delete, $"/history/{old}");
    using var again = await history.SendAsync(HttpMethod.Delete, $"/history/{old}");
    using var refused = await history.SendAsync(HttpMethod.Delete, $"/history/{current}");

    Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
    Assert.Equal("no-store", deleted.Headers.CacheControl?.ToString());
    Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
    Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
    using var list = await history.SendAsync(HttpMethod.Get, "/history");
    var lineages = JsonNode.Parse(await list.Content.ReadAsStringAsync())!["lineages"]!.AsArray();
    Assert.Equal([current], lineages.Select(entry => entry!["lineage"]!.GetValue<string>()));
  }

  [Fact]
  public async Task ADeleteOrRestoreNeedsAWritePass()
  {
    await using var history = await HistoryApp.StartAsync(auth: "ticket");
    var old = await history.OpenAsync(fixture.Compatible);
    await history.ResetAsync(fixture.Compatible);

    using var delete = await history.SendAsync(HttpMethod.Delete, $"/history/{old}", fixture.ReadOnly);
    using var restore = await history.RestoreAsync(old, "0", "read-only", ticket: fixture.ReadOnly);
    using var read = await history.SendAsync(HttpMethod.Get, $"/history/{old}/0", fixture.ReadOnly);

    await AssertError(delete, HttpStatusCode.Forbidden, "write access required\n");
    await AssertError(restore, HttpStatusCode.Forbidden, "write access required\n");
    Assert.Equal(HttpStatusCode.OK, read.StatusCode);
  }

  [Fact]
  public async Task ARestoreMakesTheLiveDocumentEqualTheVersion()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");
    using var version = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");
    var versionBlocks = JsonNode.Parse(await version.Content.ReadAsStringAsync())!["blocks"]!;

    using var restore = await history.RestoreAsync(lineage, "0", "restore-zero");

    Assert.Equal(HttpStatusCode.NoContent, restore.StatusCode);
    Assert.Equal("no-store", restore.Headers.CacheControl?.ToString());
    Assert.Equal(lineage, Assert.Single(restore.Headers.GetValues("Blok-Doc-Lineage")));
    Assert.Equal("2", Assert.Single(restore.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.True(
        JsonNode.DeepEquals(WithoutStamps(versionBlocks), WithoutStamps(await history.BlocksAsync())),
        $"{await history.BlocksAsync()}");
  }

  [Fact]
  public async Task ARetriedRestoreGetsItsFirstReceipt()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");

    using var first = await history.RestoreAsync(lineage, "0", "restore-retry");
    await history.EditTextAsync("three");
    using var retry = await history.RestoreAsync(lineage, "0", "restore-retry");

    Assert.Equal(HttpStatusCode.NoContent, retry.StatusCode);
    Assert.Equal("2", Assert.Single(first.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal("2", Assert.Single(retry.Headers.GetValues("Blok-Doc-Sequence")));
  }

  [Fact]
  public async Task ARestoreReusingAKeyForAnotherPointIsAConflict()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");
    await history.EditTextAsync("three");

    using var first = await history.RestoreAsync(lineage, "0", "restore-key");
    using var other = await history.RestoreAsync(lineage, "1", "restore-key");

    Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
    await AssertError(other, HttpStatusCode.Conflict, "the idempotency key was already used for a different edit\n");
  }

  [Fact]
  public async Task ARestoreNeedsAnIdempotencyKey()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();

    using var missing = await history.RestoreAsync(lineage, "0", key: null);

    await AssertError(missing, HttpStatusCode.BadRequest, "a valid Blok-Idempotency-Key header is required\n");
  }

  [Fact]
  public async Task ARestoreOfAnUnknownPointIsNotFound()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();

    using var pastHead = await history.RestoreAsync(lineage, "1", "restore-past");
    using var unknown = await history.RestoreAsync(UnknownLineage, "0", "restore-unknown");

    Assert.Equal(HttpStatusCode.NotFound, pastHead.StatusCode);
    Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
  }

  [Fact]
  public async Task ARestoreBehindAStaleIfMatchIsRefused()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");

    using var stale = await history.RestoreAsync(lineage, "0", "restore-stale", ifMatch: $"\"{lineage}:0\"");
    using var malformed = await history.RestoreAsync(lineage, "0", "restore-malformed", ifMatch: "*");
    using var current = await history.RestoreAsync(lineage, "0", "restore-current", ifMatch: $"\"{lineage}:1\"");

    await AssertError(stale, HttpStatusCode.PreconditionFailed, "the document is no longer at the If-Match head\n");
    Assert.Equal("1", Assert.Single(stale.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
    Assert.Equal(HttpStatusCode.NoContent, current.StatusCode);
  }

  [Fact]
  public async Task ARestoreTooLargeForOneFrameIsRefusedAndTheRoomStaysOpen()
  {
    await using var history = await HistoryApp.StartAsync(roomOptions: new CollabRoomOptions { AnnouncedMaxMessageBytes = 2048 });
    var lineage = await history.OpenAsync();
    await history.EditAsync(
        "big-insert",
        $$"""{ "ops": [ { "op": "insert", "id": "big", "after": "a", "block": { "type": "paragraph", "data": { "text": "{{new string('x', 8192)}}" } } } ] }""");
    await history.EditAsync("big-remove", """{ "ops": [ { "op": "remove", "id": "big" } ] }""");
    await using var member = await history.App.ConnectAsync(protocols: [SyncApp.Protocol]);
    await member.ReceiveAsync<BlokControlFrame>();
    await member.SendAsync(new SyncStep1Frame(YDocs.StateVector(YDocs.NewClient())));
    await member.ReceiveAsync<BlokLimitsFrame>();
    await member.ReceiveAsync<SyncStep2Frame>();
    await member.ReceiveAsync<SyncStep1Frame>();

    using var restore = await history.RestoreAsync(lineage, "1", "restore-big");

    await AssertError(restore, HttpStatusCode.RequestEntityTooLarge, "collab: the restore is larger than one update may be.\n");
    // The same member still gets the next edit: the room was not closed.
    var relay = member.ReceiveAsync<SyncUpdateFrame>();
    await history.EditTextAsync("after");
    await relay;
    using var state = await history.SendAsync(HttpMethod.Get, "/state");
    Assert.Equal("3", Assert.Single(state.Headers.GetValues("Blok-Doc-Sequence")));
  }

  [Theory]
  [InlineData("..%2Fx")]
  [InlineData("abc")]
  [InlineData("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")]
  public async Task AMalformedLineageIsNotFoundAndNeverReachesTheStore(string lineage)
  {
    await using var history = await HistoryApp.StartAsync();
    await history.OpenAsync();

    using var read = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");
    using var delete = await history.SendAsync(HttpMethod.Delete, $"/history/{lineage}");
    using var restore = await history.RestoreAsync(lineage, "0", "restore-malformed-lineage");

    foreach (var response in new[] { read, delete, restore })
    {
      await AssertError(response, HttpStatusCode.NotFound, "no such version\n");
    }

    Assert.Empty(history.Journal.LineagesAsked);
  }

  [Fact]
  public async Task EveryRouteNeedsAJournalThatKeepsHistory()
  {
    await using var noJournal = await SyncApp.StartAsync();
    var withoutHistory = new FakeCollabOperationStore();
    await using var journalOnly = await SyncApp.StartAsync(
        services: collection => collection.AddSingleton<ICollabOperationStore>(withoutHistory),
        fakes: new SyncFakes(operationStore: withoutHistory));

    foreach (var app in new[] { noJournal, journalOnly })
    {
      foreach (var response in new[]
      {
        await Send(app, HttpMethod.Get, "/history"),
        await Send(app, HttpMethod.Get, $"/history/{UnknownLineage}/0"),
        await Send(app, HttpMethod.Delete, $"/history/{UnknownLineage}"),
        await Send(app, HttpMethod.Post, $"/history/{UnknownLineage}/0/restore", key: "no-history"),
        await Send(app, HttpMethod.Get, $"/history/{UnknownLineage}/0/changes"),
      })
      {
        using (response)
        {
          await AssertError(response, HttpStatusCode.NotImplemented, "history needs a journal that keeps it\n");
          Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        }
      }
    }
  }

  [Fact]
  public async Task APurgedDocumentsHistoryIsForbidden()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    history.Journal.Purged = true;

    using var list = await history.SendAsync(HttpMethod.Get, "/history");
    using var read = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");
    using var delete = await history.SendAsync(HttpMethod.Delete, $"/history/{lineage}");
    using var restore = await history.RestoreAsync(lineage, "0", "purged");
    using var changes = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0/changes");

    await AssertError(changes, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(list, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(read, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(delete, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(restore, HttpStatusCode.Forbidden, "forbidden\n");
  }

  /// <summary>As /state: an export past the runtime's limits may pass on a retry; one that never can is a 500.</summary>
  [Fact]
  public async Task AnExportPastTheRuntimesLimitsIsARetryable503()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");

    history.Converter.ExportFailure = new CollabTransientException("collab: the runtime timed out");
    using var overloaded = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");
    using var restoreOverloaded = await history.RestoreAsync(lineage, "0", "overloaded");
    using var changesOverloaded = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/1/changes");
    history.Converter.ExportFailure = new InvalidDataException("not JSON");
    using var failed = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");
    using var changesFailed = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/1/changes");
    history.Converter.ExportFailure = null;

    await AssertError(
        changesOverloaded,
        HttpStatusCode.ServiceUnavailable,
        "the server ran past its limits exporting this version, retry\n");
    Assert.Equal(TimeSpan.FromSeconds(2), changesOverloaded.Headers.RetryAfter?.Delta);
    await AssertError(changesFailed, HttpStatusCode.InternalServerError, "the version could not be exported\n");

    await AssertError(
        overloaded,
        HttpStatusCode.ServiceUnavailable,
        "the server ran past its limits exporting this version, retry\n");
    Assert.Equal(TimeSpan.FromSeconds(2), overloaded.Headers.RetryAfter?.Delta);
    Assert.Equal(HttpStatusCode.ServiceUnavailable, restoreOverloaded.StatusCode);
    Assert.Equal(TimeSpan.FromSeconds(2), restoreOverloaded.Headers.RetryAfter?.Delta);
    await AssertError(failed, HttpStatusCode.InternalServerError, "the version could not be exported\n");
    Assert.Null(failed.Headers.RetryAfter);
  }

  [Fact]
  public async Task ACorruptRecordIsAServerErrorLoggedAtError()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();
    await history.EditTextAsync("two");
    history.Journal.CorruptRecords = true;

    using var read = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/1");
    using var restore = await history.RestoreAsync(lineage, "1", "corrupt");
    using var changes = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/1/changes");
    history.Journal.CorruptRecords = false;
    history.Journal.CorruptLineages = true;
    using var list = await history.SendAsync(HttpMethod.Get, "/history");

    await AssertError(read, HttpStatusCode.InternalServerError, "a stored version could not be read\n");
    Assert.Null(read.Headers.RetryAfter);
    await AssertError(restore, HttpStatusCode.InternalServerError, "a stored version could not be read\n");
    await AssertError(list, HttpStatusCode.InternalServerError, "a stored version could not be read\n");
    await AssertError(changes, HttpStatusCode.InternalServerError, "a stored version could not be read\n");
    var errors = history.Logs.Entries.Where(entry => entry.Level == LogLevel.Error).ToList();
    Assert.Equal(4, errors.Count);
    Assert.All(errors, entry =>
    {
      Assert.Equal("Blok.Server.Collab", entry.Category);
      Assert.Contains(SyncApp.Doc, entry.Message, StringComparison.Ordinal);
    });
  }

  [Fact]
  public async Task APassForAnotherDocumentIsRefusedOnEveryRoute()
  {
    await using var history = await HistoryApp.StartAsync(auth: "ticket");
    var lineage = await history.OpenAsync(fixture.Compatible);

    foreach (var response in new[]
    {
      await history.SendAsync(HttpMethod.Get, "/history", fixture.DocMismatch),
      await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0", fixture.DocMismatch),
      await history.SendAsync(HttpMethod.Delete, $"/history/{lineage}", fixture.DocMismatch),
      await history.RestoreAsync(lineage, "0", "mismatch", ticket: fixture.DocMismatch),
      await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0/changes", fixture.DocMismatch),
    })
    {
      using (response)
      {
        await AssertError(response, HttpStatusCode.Forbidden, "pass is for another document\n");
      }
    }
  }

  [Fact]
  public async Task ReadsAskOnlyTheReadGateAndWritesAskBoth()
  {
    var authorization = new RecordingAuthorization { AllowRead = false };
    await using var history = await HistoryApp.StartAsync(authorization: authorization);
    authorization.AllowRead = true;
    var lineage = await history.OpenAsync();
    authorization.AllowRead = false;
    authorization.Calls.Clear();

    using var list = await history.SendAsync(HttpMethod.Get, "/history");
    using var read = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");
    using var delete = await history.SendAsync(HttpMethod.Delete, $"/history/{lineage}");
    using var restore = await history.RestoreAsync(lineage, "0", "denied");
    using var changes = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0/changes");

    await AssertError(changes, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(list, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(read, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(delete, HttpStatusCode.Forbidden, "forbidden\n");
    await AssertError(restore, HttpStatusCode.Forbidden, "forbidden\n");

    authorization.AllowRead = true;
    authorization.AllowWrite = false;
    authorization.Calls.Clear();
    using var allowedList = await history.SendAsync(HttpMethod.Get, "/history");
    using var allowedRead = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0");
    using var allowedChanges = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0/changes");

    Assert.Equal(HttpStatusCode.OK, allowedChanges.StatusCode);
    Assert.Equal(HttpStatusCode.OK, allowedList.StatusCode);
    Assert.Equal(HttpStatusCode.OK, allowedRead.StatusCode);
    Assert.DoesNotContain(authorization.Calls, call => call.Method == "write");

    using var writeDenied = await history.SendAsync(HttpMethod.Delete, $"/history/{lineage}");
    await AssertError(writeDenied, HttpStatusCode.Forbidden, "forbidden\n");
  }

  [Fact]
  public async Task EachRouteAdvertisesItsOwnMethods()
  {
    await using var history = await HistoryApp.StartAsync();
    var lineage = await history.OpenAsync();

    using var list = await history.SendAsync(HttpMethod.Post, "/history");
    using var read = await history.SendAsync(HttpMethod.Delete, $"/history/{lineage}/0");
    using var delete = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}");
    using var restore = await history.SendAsync(HttpMethod.Get, $"/history/{lineage}/0/restore");
    using var head = await history.SendAsync(HttpMethod.Head, "/history");
    using var changes = await history.SendAsync(HttpMethod.Post, $"/history/{lineage}/0/changes");

    Assert.Equal(HttpStatusCode.MethodNotAllowed, list.StatusCode);
    Assert.Equal("GET, OPTIONS", string.Join(", ", list.Content.Headers.Allow));
    Assert.Equal("GET, OPTIONS", string.Join(", ", read.Content.Headers.Allow));
    Assert.Equal("DELETE, OPTIONS", string.Join(", ", delete.Content.Headers.Allow));
    Assert.Equal("OPTIONS, POST", string.Join(", ", restore.Content.Headers.Allow));
    Assert.Equal(HttpStatusCode.MethodNotAllowed, head.StatusCode);
    Assert.Equal(HttpStatusCode.MethodNotAllowed, changes.StatusCode);
    Assert.Equal("GET, OPTIONS", string.Join(", ", changes.Content.Headers.Allow));
  }

  [Fact]
  public async Task ADeletePreflightIsAllowed()
  {
    await using var history = await HistoryApp.StartAsync();
    using var request = new HttpRequestMessage(HttpMethod.Options, $"/sync/{SyncApp.Doc}/history/{UnknownLineage}");
    request.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);
    request.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "DELETE");

    using var response = await history.App.CreateClient().SendAsync(request);

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    Assert.Equal(SyncApp.AllowedOrigin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    Assert.Equal("DELETE, OPTIONS", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Methods")));
  }

  private static void AssertUnixMilliseconds(JsonNode? value)
  {
    var at = DateTimeOffset.FromUnixTimeMilliseconds(Assert.IsAssignableFrom<JsonValue>(value).GetValue<long>());
    Assert.InRange(at, DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddMinutes(1));
  }

  private static JsonNode WithoutStamps(JsonNode blocks)
  {
    var copy = blocks.DeepClone();

    foreach (var block in copy.AsArray().OfType<JsonObject>())
    {
      block.Remove("lastEditedAt");
      block.Remove("lastEditedBy");
    }

    return copy;
  }

  private static async Task<HttpResponseMessage> Send(
      SyncApp app,
      HttpMethod method,
      string path,
      string? ticket = null,
      string? key = null,
      string? ifMatch = null,
      string? body = null)
  {
    using var request = new HttpRequestMessage(method, $"/sync/{SyncApp.Doc}{path}");
    request.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);

    if (ticket is not null)
    {
      request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {ticket}");
    }

    if (key is not null)
    {
      request.Headers.TryAddWithoutValidation("Blok-Idempotency-Key", key);
    }

    if (ifMatch is not null)
    {
      request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
    }

    if (body is not null)
    {
      request.Content = new StringContent(body, Encoding.UTF8, "application/json");
    }

    return await app.CreateClient().SendAsync(request);
  }

  private static async Task AssertError(
      HttpResponseMessage response,
      HttpStatusCode status,
      string body)
  {
    Assert.Equal(status, response.StatusCode);
    Assert.Equal(
        "text/plain; charset=utf-8",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(body, await response.Content.ReadAsStringAsync());
  }

  /// <summary>A SyncApp on the local journal and the real converter, with switches for the failures.</summary>
  private sealed class HistoryApp : IAsyncDisposable
  {
    private readonly string directory;

    private HistoryApp(SyncApp app, HistoryJournal journal, FailingConverter converter, CapturingLoggerProvider logs, string directory)
    {
      App = app;
      Journal = journal;
      Converter = converter;
      Logs = logs;
      this.directory = directory;
    }

    internal SyncApp App { get; }

    internal HistoryJournal Journal { get; }

    internal FailingConverter Converter { get; }

    internal CapturingLoggerProvider Logs { get; }

    internal static async Task<HistoryApp> StartAsync(
        string auth = "none",
        CollabRoomOptions? roomOptions = null,
        IBlokAuthorization? authorization = null)
    {
      var directory = Path.Combine(Path.GetTempPath(), $"blok-history-tests-{Guid.NewGuid():N}");
      var journal = new HistoryJournal(new LocalCollabOperationStore(directory));
      var converter = new FailingConverter(new CollabDocConverter(TimeProvider.System, Reader.Value));
      var logs = new CapturingLoggerProvider();
      var fakes = new SyncFakes(roomOptions, journal, converter);
      fakes.Endpoint.HoldsDocument(SyncApp.Doc, new JsonObject
      {
        ["blocks"] = new JsonArray(new JsonObject
        {
          ["id"] = "a",
          ["type"] = "paragraph",
          ["data"] = new JsonObject { ["text"] = "one" },
        }),
      });
      var app = await SyncApp.StartAsync(
          auth,
          services: collection =>
          {
            collection.AddSingleton<ICollabOperationStore>(journal);
            collection.AddSingleton<ILoggerProvider>(logs);

            if (authorization is not null)
            {
              collection.AddSingleton(authorization);
            }
          },
          fakes: fakes);

      return new HistoryApp(app, journal, converter, logs, directory);
    }

    /// <summary>Loads the room through /state and answers its lineage.</summary>
    internal async Task<string> OpenAsync(string? ticket = null)
    {
      using var state = await SendAsync(HttpMethod.Get, "/state", ticket);

      Assert.Equal(HttpStatusCode.OK, state.StatusCode);

      return Assert.Single(state.Headers.GetValues("Blok-Doc-Lineage"));
    }

    internal async Task<JsonNode> BlocksAsync(string? ticket = null)
    {
      using var state = await SendAsync(HttpMethod.Get, "/state", ticket);

      Assert.Equal(HttpStatusCode.OK, state.StatusCode);

      return JsonNode.Parse(await state.Content.ReadAsStringAsync())!["blocks"]!;
    }

    /// <summary>Waits until the live head reaches <paramref name="sequence"/>: a socket write commits on its own time.</summary>
    internal async Task WaitForSequenceAsync(ulong sequence)
    {
      var deadline = DateTime.UtcNow + Deadline.Length;

      while (true)
      {
        using var state = await SendAsync(HttpMethod.Get, "/state");

        if (ulong.Parse(Assert.Single(state.Headers.GetValues("Blok-Doc-Sequence")), System.Globalization.CultureInfo.InvariantCulture) >= sequence)
        {
          return;
        }

        Assert.True(DateTime.UtcNow < deadline, $"the head never reached {sequence}");
        await Task.Delay(20);
      }
    }

    internal Task EditTextAsync(string text, string? ticket = null)
    {
      return EditAsync(
          Guid.NewGuid().ToString("N"),
          $$"""{ "ops": [ { "op": "update", "id": "a", "data": { "text": "{{text}}" } } ] }""",
          ticket);
    }

    internal async Task EditAsync(string key, string body, string? ticket = null)
    {
      using var edit = await Send(App, HttpMethod.Post, "/edit", ticket, key, body: body);

      Assert.Equal(HttpStatusCode.NoContent, edit.StatusCode);
    }

    internal async Task ResetAsync(string? ticket = null)
    {
      using var reset = await SendAsync(HttpMethod.Post, "/reset", ticket);

      Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
    }

    internal Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? ticket = null)
    {
      return Send(App, method, path, ticket);
    }

    internal Task<HttpResponseMessage> RestoreAsync(
        string lineage,
        string sequence,
        string? key,
        string? ifMatch = null,
        string? ticket = null)
    {
      return Send(App, HttpMethod.Post, $"/history/{lineage}/{sequence}/restore", ticket, key, ifMatch);
    }

    public async ValueTask DisposeAsync()
    {
      await App.DisposeAsync();

      try
      {
        Directory.Delete(directory, recursive: true);
      }
      catch (IOException)
      {
      }
    }
  }

  /// <summary>The local journal, with switches for a purge and for unreadable data.</summary>
  private sealed class HistoryJournal(LocalCollabOperationStore inner) : ICollabOperationStore, ICollabOperationHistoryStore
  {
    internal bool Purged { get; set; }

    internal bool CorruptRecords { get; set; }

    internal bool CorruptLineages { get; set; }

    /// <summary>When set, header N reads as committed at the Unix epoch plus N times this.</summary>
    internal TimeSpan? HeaderSpacing { get; set; }

    internal ConcurrentQueue<string> LineagesAsked { get; } = new();

    public ValueTask<CollabDocumentOpen> OpenAsync(string documentId, CancellationToken cancellationToken = default)
    {
      return Purged ? ValueTask.FromResult(CollabDocumentOpen.Purged) : inner.OpenAsync(documentId, cancellationToken);
    }

    public async ValueTask<bool> IsPurgedAsync(string documentId, CancellationToken cancellationToken = default)
    {
      return Purged || await inner.IsPurgedAsync(documentId, cancellationToken);
    }

    public ValueTask<IReadOnlyList<CollabLineageInfo>> ListLineagesAsync(
        string documentId,
        CancellationToken cancellationToken = default)
    {
      return CorruptLineages
        ? throw new InvalidDataException("the lineage ledger is torn")
        : inner.ListLineagesAsync(documentId, cancellationToken);
    }

    public ValueTask<IReadOnlyList<ReadOnlyMemory<byte>>?> ReadBaselineAsync(
        string documentId,
        string lineage,
        CancellationToken cancellationToken = default)
    {
      LineagesAsked.Enqueue(lineage);

      return inner.ReadBaselineAsync(documentId, lineage, cancellationToken);
    }

    public IAsyncEnumerable<CollabRecordHeader> ReadHeadersAsync(
        string documentId,
        string lineage,
        CancellationToken cancellationToken = default)
    {
      LineagesAsked.Enqueue(lineage);
      var headers = inner.ReadHeadersAsync(documentId, lineage, cancellationToken);

      return HeaderSpacing is { } spacing
        ? headers.Select(header => header with { CommittedAt = DateTimeOffset.UnixEpoch + (spacing * header.ServerSequence) })
        : headers;
    }

    public IAsyncEnumerable<CollabOperationRecord> ReadRecordsAsync(
        string documentId,
        string lineage,
        ulong through,
        CancellationToken cancellationToken = default)
    {
      LineagesAsked.Enqueue(lineage);

      return CorruptRecords ? Unreadable(cancellationToken) : inner.ReadRecordsAsync(documentId, lineage, through, cancellationToken);
    }

    public async ValueTask<CollabLineageDeleteOutcome> DeleteLineageAsync(
        string documentId,
        string lineage,
        CancellationToken cancellationToken = default)
    {
      LineagesAsked.Enqueue(lineage);

      return Purged
        ? CollabLineageDeleteOutcome.Purged
        : await inner.DeleteLineageAsync(documentId, lineage, cancellationToken);
    }

    private static async IAsyncEnumerable<CollabOperationRecord> Unreadable(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
      await Task.Yield();
      cancellationToken.ThrowIfCancellationRequested();

      throw new InvalidDataException("a record's checksum does not match");
#pragma warning disable CS0162 // An iterator needs a yield.
      yield break;
#pragma warning restore CS0162
    }
  }

  /// <summary>The real converter, whose exports throw <see cref="ExportFailure"/> while it is set.</summary>
  private sealed class FailingConverter(CollabDocConverter inner) : ICollabDocConverter
  {
    internal Exception? ExportFailure { get; set; }

    public ValueTask SeedAsync(YDoc doc, JsonNode outputData, CancellationToken cancellationToken = default)
    {
      return inner.SeedAsync(doc, outputData, cancellationToken);
    }

    public ValueTask<JsonNode> ExportAsync(YDoc doc, CancellationToken cancellationToken = default)
    {
      return ExportFailure is { } failure ? throw failure : inner.ExportAsync(doc, cancellationToken);
    }

    public ValueTask ApplyOpsAsync(YDoc doc, IReadOnlyList<CollabEditOp> ops, CancellationToken cancellationToken = default)
    {
      return inner.ApplyOpsAsync(doc, ops, cancellationToken);
    }

    public ValueTask<int> MigrateRichTextAsync(YDoc doc, CancellationToken cancellationToken = default)
    {
      return inner.MigrateRichTextAsync(doc, cancellationToken);
    }

    public JsonArray ExportBlocks(YDoc doc, ISet<string> warned, out IReadOnlyList<RichTextHtmlSlot> slots)
    {
      return ExportFailure is { } failure ? throw failure : inner.ExportBlocks(doc, warned, out slots);
    }

    public ValueTask ResolveAsync(IReadOnlyList<RichTextHtmlSlot> slots, CancellationToken cancellationToken = default)
    {
      return inner.ResolveAsync(slots, cancellationToken);
    }
  }
}
