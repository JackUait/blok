using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The CRDT core against the real-yjs oracle. Every scenario was produced by
/// running the same delivery schedule over real yjs documents, so a
/// disagreement here is a bug in this port and never in the fixture.
/// </summary>
public sealed class IntegrationTests
{
  private static readonly Dictionary<string, string> BlocksRoot =
      new(StringComparer.Ordinal) { ["blocks"] = "map" };

  public static TheoryData<string> ScenarioNames()
  {
    var names = new TheoryData<string>();

    foreach (var testCase in ScenarioSupport.Scenarios())
    {
      names.Add(testCase.Name);
    }

    return names;
  }

  public static TheoryData<string> StructsNames()
  {
    return FixtureNames("structs.json");
  }

  public static TheoryData<string> YrsNames()
  {
    return FixtureNames("yrs-compat.json");
  }

  [Fact]
  public void ConcurrentMapSetOnSameKeyResolvesLikeYjs()
  {
    // Both cases turn on the same rule: the higher client id wins the key,
    // whatever order the updates arrive in.
    RunScenario("concurrent-map-set-two-clients");
    RunScenario("concurrent-map-set-three-clients");
  }

  [Fact]
  public void ConcurrentArrayInsertAtSamePositionFollowsYata()
  {
    RunScenario("concurrent-array-insert-three-clients");
    RunScenario("array-run-split-by-remote-insert");
    RunScenario("delete-concurrent-with-insert-in-run");
  }

  [Fact]
  public void OutOfOrderDeliveryRetainsPendingThenConverges()
  {
    var runner = new ScenarioRunner(Scenario("out-of-order-delivery"));

    runner.RunAll();

    Assert.False(runner.Doc.HasPending);
    Assert.True(runner.Checks >= 9);
  }

  [Fact]
  public void SameClientGapParksTheTail()
  {
    var testCase = Scenario("out-of-order-delivery");
    var runner = new ScenarioRunner(testCase);

    // Only the third op of a three-op run: nothing can be placed, and the
    // gap is recorded as "waiting for the clock before this one".
    Deliver(runner, testCase, "s3");

    Assert.True(runner.Doc.HasPending);
    Assert.Empty(runner.Doc.Store.Clients);

    var parked = Assert.Single(runner.Doc.Store.PendingStructs!);

    Assert.Equal(new YId(1000, 2), parked.Id);
    Assert.Equal(1UL, runner.Doc.Store.PendingMissing!.Get(1000));
  }

  [Fact]
  public void PendingRetriesWhenTheDependencyArrives()
  {
    var testCase = Scenario("out-of-order-delivery");
    var runner = new ScenarioRunner(testCase);

    Deliver(runner, testCase, "s3");
    Deliver(runner, testCase, "s1");

    // Clock 1 is still missing, so the parked clock 2 stays parked.
    Assert.True(runner.Doc.HasPending);
    Assert.Equal(1UL, runner.Doc.Store.GetState(1000));

    Deliver(runner, testCase, "s2");

    // The arriving struct closed the gap, and the retry ran inside the same
    // transaction, so all three clocks are in after one apply.
    Assert.False(runner.Doc.HasPending);
    Assert.Equal(3UL, runner.Doc.Store.GetState(1000));
    Assert.Null(runner.Doc.Store.PendingStructs);
    Assert.Null(runner.Doc.Store.PendingMissing);
  }

  [Fact]
  public void DuplicateDeliveryIsIdempotent()
  {
    var testCase = Scenario("duplicate-delivery");
    var runner = new ScenarioRunner(testCase);

    runner.RunAll();

    // The same DECODED update applied twice, not just the same bytes: the
    // engine must not integrate a payload it already spliced.
    var doc = new YDoc(4242);
    var decoded = UpdateV1Decoder.Decode(Update(testCase, "s1"));

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(decoded).Outcome);

    var once = YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, testCase.Roots));
    var vector = doc.EncodeStateVector();

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(decoded).Outcome);
    Assert.Equal(once, YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, testCase.Roots)));
    Assert.Equal(vector, doc.EncodeStateVector());
    Assert.False(doc.HasPending);
  }

  [Fact]
  public void DeletingABlockCascadesIntoNestedTypesAndMatchesYjsDeleteSet()
  {
    var testCase = Scenario("cascade-delete-grid");
    var runner = new ScenarioRunner(testCase);
    var seen = new List<DeleteSet>();

    runner.Doc.UpdateEncoder = transaction =>
    {
      seen.Add(transaction.DeleteSet);

      return null;
    };

    runner.RunAll();

    Assert.False(runner.Doc.HasPending);

    // The delete update names the whole run; the cascade is what actually
    // deletes the eleven structs, and the transaction records every one.
    var deletions = seen[^1];

    Assert.Equal([new DeleteRange(0, 11)], deletions.Clients.Single().Value);
    Assert.Equal(1000UL, deletions.Clients.Single().Key);
    Assert.All(runner.Doc.Store.Clients[1000], entry => Assert.True(entry.IsDeleted));
  }

  [Fact]
  public void ContentGcReplacesDeletedContentAndSubtrees()
  {
    var collected = new ScenarioRunner(Scenario("cascade-delete-grid"));

    collected.RunAll();

    var structs = collected.Doc.Store.Clients[1000];

    // The head keeps its place with a tombstone; everything the grid held is
    // collected into GC runs, which is what stops a deleted block costing
    // what it held.
    Assert.IsType<ContentDeleted>(Assert.IsType<YItem>(structs[0]).Content);
    Assert.All(structs.Skip(1), entry => Assert.IsType<YGc>(entry));

    var kept = new ScenarioRunner(Scenario("cascade-delete-grid-no-gc"));

    kept.RunAll();

    var keptStructs = kept.Doc.Store.Clients[1000];

    Assert.Equal(structs.Sum(entry => entry.Length), keptStructs.Sum(entry => entry.Length));
    Assert.All(keptStructs, entry => Assert.True(Assert.IsType<YItem>(entry).Deleted));
    Assert.IsType<ContentType>(((YItem)keptStructs[0]).Content);
  }

  [Theory]
  [MemberData(nameof(ScenarioNames))]
  public void EveryScenarioMatchesTheYjsOracle(string name)
  {
    var runner = new ScenarioRunner(Scenario(name));

    runner.RunAll();

    Assert.True(runner.Checks > 0, $"\"{name}\" asserted nothing");
  }

  [Theory]
  [MemberData(nameof(StructsNames))]
  public void EveryStructsGoldenAppliesToItsJson(string name)
  {
    var golden = Fixture("structs.json", name);
    var roots = golden["roots"]!.AsObject()
        .ToDictionary(entry => entry.Key, entry => entry.Value!.GetValue<string>(), StringComparer.Ordinal);
    var doc = new YDoc(7) { Gc = golden["gc"]!.GetValue<bool>() };
    var result = doc.ApplyUpdate(Convert.FromBase64String(golden["update"]!.GetValue<string>()));

    Assert.Equal(ApplyOutcome.Applied, result.Outcome);
    Assert.Equal(golden["hasPending"]!.GetValue<bool>(), doc.HasPending);
    Assert.Equal(
        YjsEngineFixtures.Canonicalize(golden["json"]),
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, roots)));
  }

  [Theory]
  [MemberData(nameof(YrsNames))]
  public void ReplaysEveryYrsEncodedFixture(string name)
  {
    // Bytes yrs produced, which no longer can be: spec-compliant but not the
    // shapes yjs writes. The JSON oracle is the converter's, which lands in
    // Task 5.1, so this pins acceptance and idempotency instead.
    var golden = Fixture("yrs-compat.json", name);
    var update = Convert.FromBase64String(golden["update"]!.GetValue<string>());
    var doc = new YDoc(7);

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
    Assert.False(doc.HasPending);

    var rendered = YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, BlocksRoot));
    var vector = doc.EncodeStateVector();

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
    Assert.Equal(vector, doc.EncodeStateVector());
    Assert.Equal(rendered, YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, BlocksRoot)));
  }

  [Fact]
  public void RemoteAdvanceOfTheLocalClockRegeneratesTheClientId()
  {
    var testCase = Scenario("concurrent-map-set-two-clients");
    var impostor = new YDoc(1000);

    Assert.Equal(ApplyOutcome.Applied, impostor.ApplyUpdate(Update(testCase, "s1")).Outcome);

    // The update was authored by client 1000; keeping that id would fork the
    // clock line between two writers.
    Assert.NotEqual(1000UL, impostor.ClientId);

    var bystander = new YDoc(4242);

    Assert.Equal(ApplyOutcome.Applied, bystander.ApplyUpdate(Update(testCase, "s1")).Outcome);
    Assert.Equal(4242UL, bystander.ClientId);
  }

  [Fact]
  public void MalformedBytesReportMalformedAndLeaveTheDocUntouched()
  {
    var testCase = Scenario("concurrent-map-set-two-clients");
    var doc = new YDoc(4242);

    doc.ApplyUpdate(Update(testCase, "s1"));

    var vector = doc.EncodeStateVector();
    var rendered = YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, testCase.Roots));

    // A truncated struct group: the decoder reads the whole update before
    // anything is integrated, so a refusal costs the document nothing.
    var result = doc.ApplyUpdate(new byte[] { 1, 1, 0xE8, 0x07 });

    Assert.Equal(ApplyOutcome.Malformed, result.Outcome);
    Assert.False(string.IsNullOrEmpty(result.Reason));
    Assert.Equal(vector, doc.EncodeStateVector());
    Assert.Equal(
        rendered, YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, testCase.Roots)));
  }

  [Fact]
  public void CanonicalJsonMatchesTheGeneratorsHash()
  {
    // The fuzz seeds carry a hash instead of the whole JSON, so the C# side
    // has to reproduce JavaScript's JSON.stringify byte for byte — including
    // leaving non-ASCII unescaped, which the default encoder does not.
    var seed = ScenarioSupport.FuzzSeeds()[0];
    var last = seed.Steps.Last(step => step.Expect?.Json is not null).Expect!;

    Assert.Equal(last.JsonSha256, ScenarioSupport.JsonSha256(last.Json));
  }

  private static void RunScenario(string name)
  {
    var runner = new ScenarioRunner(Scenario(name));

    runner.RunAll();

    Assert.True(runner.Checks > 0, $"\"{name}\" asserted nothing");
  }

  private static void Deliver(ScenarioRunner runner, ScenarioCase testCase, string id)
  {
    runner.Run(new ScenarioStep(
        "deliver", null, null, null, Update(testCase, id), null, null, null));
  }

  private static byte[] Update(ScenarioCase testCase, string id)
  {
    return testCase.Steps.Single(step => step.Id == id).Update ??
        throw new InvalidDataException($"step \"{id}\" carries no update");
  }

  private static ScenarioCase Scenario(string name)
  {
    return ScenarioSupport.Scenarios().Single(testCase => testCase.Name == name);
  }

  private static JsonObject Fixture(string file, string name)
  {
    return YjsEngineFixtures.Cases(file)
        .OfType<JsonObject>()
        .Single(entry => entry["name"]!.GetValue<string>() == name);
  }

  private static TheoryData<string> FixtureNames(string file)
  {
    var names = new TheoryData<string>();

    foreach (var entry in YjsEngineFixtures.Cases(file))
    {
      names.Add(entry!["name"]!.GetValue<string>());
    }

    return names;
  }
}
