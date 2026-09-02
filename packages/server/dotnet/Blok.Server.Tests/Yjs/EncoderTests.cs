using System.Text.Json.Nodes;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// The C# → Node direction of the interop law: every update this engine
/// writes is applied by a real yjs document, and the JSON that document
/// renders must be the JSON the engine renders. A disagreement is a bug in
/// this port, never in the fixture.
/// </summary>
public sealed class EncoderTests
{
  /// <summary>The yrs cases whose Any number tags no lib0 writer reproduces.</summary>
  private static readonly HashSet<string> YrsNumberTags =
      new(StringComparer.Ordinal) { "array-kinds", "edit-metadata" };

  public static TheoryData<string> ScenarioNames()
  {
    var names = new TheoryData<string>();

    foreach (var testCase in ScenarioSupport.Scenarios())
    {
      names.Add(testCase.Name);
    }

    return names;
  }

  public static TheoryData<string, string> EveryFixtureUpdate()
  {
    var updates = new TheoryData<string, string>();

    foreach (var file in new[] { "structs.json", "yrs-compat.json" })
    {
      foreach (var fixture in YjsEngineFixtures.Cases(file))
      {
        updates.Add(file, Name(fixture));
      }
    }

    return updates;
  }

  /// <summary>
  /// The wire form of a struct is not recoverable from the store — integration
  /// splits runs, GC collapses content — so this drives the three writers over
  /// freshly decoded structs and asks for the same bytes back.
  /// </summary>
  [Theory]
  [MemberData(nameof(EveryFixtureUpdate))]
  public void DecodeThenReencodeIsByteIdenticalWithoutMerging(string file, string name)
  {
    var update = FixtureUpdate(file, name);
    var reencoded = Reencode(update);

    if (YrsNumberTags.Contains(name))
    {
      // yrs writes a big integer as a varint Any (tag 125) where lib0 writes a
      // float (124 or 123): yrs picks the tag from the Rust type, and this
      // engine's numbers are doubles (Locked Decision 2). yjs's own diffUpdate
      // rewrites these very bytes the same way, so what must hold is only that
      // the rewrite is a fixed point.
      Assert.Equal(reencoded, Reencode(reencoded));

      return;
    }

    Assert.Equal(update, reencoded);
  }

  /// <summary>
  /// Every struct back through its own writer, in the wire's group order and
  /// at the wire's start clocks. Nothing is integrated, so nothing is merged,
  /// split or collected on the way.
  /// </summary>
  private static byte[] Reencode(byte[] update)
  {
    var decoded = UpdateV1Decoder.Decode(update);
    var runtime = Integrator.ToRuntimeStructs(decoded);
    var writer = new Lib0Writer();

    writer.WriteVarUint((ulong)decoded.Structs.Count);

    foreach (var (client, wire) in decoded.Structs)
    {
      var structs = runtime[client];

      writer.WriteVarUint((ulong)structs.Count);
      writer.WriteVarUint(client);
      writer.WriteVarUint(wire[0].Id.Clock);

      foreach (var current in structs)
      {
        UpdateV1Encoder.WriteStruct(writer, current, 0);
      }
    }

    decoded.DeleteSet.Write(writer);

    return writer.ToArray();
  }

  /// <summary>
  /// The whole document as one update, applied to a fresh real yjs doc. This
  /// is what a joining peer receives, so the two documents must agree on the
  /// JSON, on the state vector and on whether anything is still parked.
  /// </summary>
  [Theory]
  [MemberData(nameof(ScenarioNames))]
  public void DiffAgainstAnEmptyVectorReplaysIntoYjsWithIdenticalJson(string name)
  {
    var testCase = Scenario(name);
    var runner = new ScenarioRunner(testCase);

    runner.RunAll();

    var replay = NodeReplay.Run(testCase.Roots, [runner.Doc.EncodeStateAsUpdate()], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(runner.Doc, testCase.Roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));
    Assert.Equal(runner.Doc.EncodeStateVector(), replay.StateVector);
    Assert.Equal(runner.Doc.HasPending, replay.HasPending);
  }

  /// <summary>
  /// The sync path: a peer that stopped listening half way asks for the rest.
  /// Its snapshot plus the diff has to be the whole document, which is the
  /// only thing that makes the start clock and the offset of a run matter.
  /// </summary>
  [Theory]
  [MemberData(nameof(ScenarioNames))]
  public void DiffAgainstAPeerVectorIsAcceptedByYjs(string name)
  {
    var testCase = Scenario(name);
    var runner = new ScenarioRunner(testCase);
    var half = testCase.Steps.Count / 2;

    for (var step = 0; step < half; step++)
    {
      runner.Run(testCase.Steps[step]);
    }

    var atHalf = runner.Doc.EncodeStateAsUpdate();
    var peer = runner.Doc.EncodeStateVector();

    for (var step = half; step < testCase.Steps.Count; step++)
    {
      runner.Run(testCase.Steps[step]);
    }

    var replay = NodeReplay.Run(
        testCase.Roots, [atHalf, runner.Doc.EncodeStateAsUpdate(peer)], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(runner.Doc, testCase.Roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));
    Assert.Equal(runner.Doc.EncodeStateVector(), replay.StateVector);
  }

  /// <summary>
  /// A document holding a parked struct still has to be encodable, and the
  /// hole before it has to be named: yjs reads a Skip as "clocks I am not
  /// filling", and without one the run would look contiguous and be integrated.
  /// </summary>
  [Fact]
  public void PendingWithGapsEncodesSkipsReadableByYjs()
  {
    var testCase = Scenario("engine-writes-while-pending");
    var runner = new ScenarioRunner(testCase);

    // Every step but the last delivery, which is the one that closes the gap.
    for (var step = 0; step < testCase.Steps.Count - 2; step++)
    {
      runner.Run(testCase.Steps[step]);
    }

    Assert.True(runner.Doc.HasPending);

    var pending = runner.Doc.EncodeStateAsUpdate();
    var decoded = UpdateV1Decoder.Decode(pending);

    Assert.Contains(
        decoded.Structs[1000],
        entry => entry.Kind == DecodedStructKind.Skip);

    var replay = NodeReplay.Run(testCase.Roots, [pending], null);

    Assert.True(replay.HasPending);
    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(runner.Doc, testCase.Roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));

    var closing = Update(testCase, "s2");

    runner.Doc.ApplyUpdate(closing);

    var converged = NodeReplay.Run(testCase.Roots, [pending, closing], null);

    Assert.False(runner.Doc.HasPending);
    Assert.False(converged.HasPending);
    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(runner.Doc, testCase.Roots)),
        YjsEngineFixtures.Canonicalize(converged.Json));
  }

  /// <summary>
  /// The room compares these bytes directly, so every golden is checked here
  /// rather than only inside the runner.
  /// </summary>
  [Theory]
  [MemberData(nameof(ScenarioNames))]
  public void EncodedStateVectorMatchesEveryScenarioGolden(string name)
  {
    var testCase = Scenario(name);
    var runner = new ScenarioRunner(testCase);
    var checks = 0;

    foreach (var step in testCase.Steps)
    {
      runner.Run(step);

      if (step.Expect?.StateVector is not { } golden ||
          (step.Doc is not null && step.Doc != testCase.Engine))
      {
        continue;
      }

      Assert.Equal(golden, runner.Doc.EncodeStateVector());
      checks++;
    }

    Assert.True(checks > 0, $"\"{name}\" carries no state vector golden");
  }

  /// <summary>
  /// One local write, one emitted update, and a yjs doc that ends up holding
  /// it. The item is built by hand because the write API is Task 4.1.
  /// </summary>
  [Fact]
  public void TransactionEmitsOneUpdateThatReplaysIntoYjs()
  {
    var (seed, roots) = StructsCase("map-set-any");
    var doc = new YDoc(4242);

    doc.ApplyUpdate(seed);

    var emitted = new List<YUpdateEvent>();

    doc.UpdateEmitted += emitted.Add;

    var written = doc.Transact(transaction =>
    {
      var root = doc.GetMap("m");

      new YItem
      {
        Id = new YId(doc.ClientId, doc.Store.GetState(doc.ClientId)),
        Length = 1,
        Parent = root,
        ParentSub = "engine",
        Content = new ContentAny(["written"]),
      }.Integrate(transaction, 0);
    });

    var only = Assert.Single(emitted);

    Assert.True(only.Local);
    Assert.Equal(only.Update, written);

    var replay = NodeReplay.Run(roots, [seed, only.Update], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  /// <summary>
  /// An applied update is emitted too, and it describes what the apply
  /// changed rather than the whole document: the room relays it verbatim.
  /// </summary>
  [Fact]
  public void ApplyEmitsTheAppliedChangeOnly()
  {
    var testCase = Scenario("out-of-order-delivery");
    var doc = new YDoc(4242);
    var first = Update(testCase, "s1");
    var second = Update(testCase, "s2");

    doc.ApplyUpdate(first);

    var emitted = new List<YUpdateEvent>();

    doc.UpdateEmitted += emitted.Add;
    doc.ApplyUpdate(second);

    var only = Assert.Single(emitted);

    Assert.False(only.Local);

    var replay = NodeReplay.Run(testCase.Roots, [first, only.Update], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, testCase.Roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  [Fact]
  public void NothingChangedEmitsNothing()
  {
    var testCase = Scenario("out-of-order-delivery");
    var doc = new YDoc(4242);
    var update = Update(testCase, "s1");

    doc.ApplyUpdate(update);

    var emitted = new List<YUpdateEvent>();

    doc.UpdateEmitted += emitted.Add;
    doc.ApplyUpdate(update);

    Assert.Empty(emitted);
    Assert.Null(doc.Transact(_ => { }));
    Assert.Empty(emitted);
  }

  /// <summary>
  /// Embeds and formatting marks are foreign content this engine never writes
  /// itself, and a delta is where a lost mark shows up.
  /// </summary>
  [Fact]
  public void ForeignTextEmbedsAndFormatsSurviveTheOracle()
  {
    var (update, roots) = StructsCase("text-insert-format-embed");
    var doc = new YDoc(4242);

    doc.ApplyUpdate(update);

    var replay = NodeReplay.Run(roots, [doc.EncodeStateAsUpdate()], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(doc, roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));
  }

  private static ScenarioCase Scenario(string name)
  {
    return ScenarioSupport.Scenarios().Single(testCase => testCase.Name == name);
  }

  private static byte[] Update(ScenarioCase testCase, string id)
  {
    return testCase.Steps.Single(step => step.Id == id).Update ??
        throw new InvalidDataException($"step \"{id}\" carries no update");
  }

  /// <summary>One structs.json case: its update and the roots it renders.</summary>
  private static (byte[] Update, Dictionary<string, string> Roots) StructsCase(string name)
  {
    foreach (var fixture in YjsEngineFixtures.Cases("structs.json"))
    {
      if (Name(fixture) != name)
      {
        continue;
      }

      var roots = (fixture?["roots"] as JsonObject ??
          throw new InvalidDataException($"\"{name}\" has no roots"))
          .ToDictionary(
              entry => entry.Key,
              entry => entry.Value?.GetValue<string>() ??
                  throw new InvalidDataException($"\"{name}\" has an unnamed root kind"),
              StringComparer.Ordinal);

      return (FixtureUpdate("structs.json", name), roots);
    }

    throw new InvalidDataException($"structs.json has no case named \"{name}\"");
  }

  private static byte[] FixtureUpdate(string file, string name)
  {
    foreach (var fixture in YjsEngineFixtures.Cases(file))
    {
      if (Name(fixture) == name)
      {
        return Convert.FromBase64String(
            fixture?["update"]?.GetValue<string>() ??
            throw new InvalidDataException($"{file} case \"{name}\" carries no update"));
      }
    }

    throw new InvalidDataException($"{file} has no case named \"{name}\"");
  }

  private static string Name(JsonNode? fixture)
  {
    return fixture?["name"]?.GetValue<string>() ??
        throw new InvalidDataException("a fixture case has no name");
  }
}
