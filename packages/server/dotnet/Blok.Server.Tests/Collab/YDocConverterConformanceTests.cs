using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;
using YDotNet.Document.Transactions;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Three directions per fixture: JSON→doc→JSON (Seed mirrors fromJSON),
/// client update→doc→JSON (Export reads what the JS client wrote), and
/// Seed→StateDiffV1→ApplyV1→Export (the C# encoder round-trips).
/// </summary>
public sealed class YDocConverterConformanceTests
{
  public static TheoryData<string> Cases()
  {
    return new TheoryData<string>(YDocConverterFixtures.CaseNames());
  }

  [Fact]
  public void ManifestListsExactlyTheCommittedCases()
  {
    var names = YDocConverterFixtures.CaseNames();

    Assert.NotEmpty(names);
    Assert.Equal(
        names,
        YDocConverterFixtures.ManifestCaseNames().Order(StringComparer.Ordinal));
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void SeedingInputJsonExportsCanonicalJson(string name)
  {
    var fixture = YDocConverterFixtures.Load(name);
    using var doc = new Doc();

    YDocConverter.Seed(doc, fixture.Input);

    AssertJsonEqual(fixture.Canonical, YDocConverter.Export(doc));
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void ApplyingTheClientUpdateExportsCanonicalJson(string name)
  {
    var fixture = YDocConverterFixtures.Load(name);
    using var doc = new Doc();

    using (var transaction = doc.WriteTransaction())
    {
      Assert.Equal(
          TransactionUpdateResult.Ok,
          transaction.ApplyV1(fixture.Update));
    }

    AssertJsonEqual(fixture.Canonical, YDocConverter.Export(doc));
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void SeedRoundTripsThroughStateDiffIntoASecondDoc(string name)
  {
    var fixture = YDocConverterFixtures.Load(name);
    using var source = new Doc();
    using var replica = new Doc();

    YDocConverter.Seed(source, fixture.Input);

    byte[] replicaVector;

    using (var transaction = replica.ReadTransaction())
    {
      replicaVector = transaction.StateVectorV1();
    }

    byte[] diff;

    using (var transaction = source.ReadTransaction())
    {
      diff = transaction.StateDiffV1(replicaVector);
    }

    using (var transaction = replica.WriteTransaction())
    {
      Assert.Equal(TransactionUpdateResult.Ok, transaction.ApplyV1(diff));
    }

    var exported = YDocConverter.Export(replica);

    AssertJsonEqual(fixture.Canonical, exported);
    AssertJsonEqual(YDocConverter.Export(source), exported);
  }

  private static void AssertJsonEqual(
      System.Text.Json.Nodes.JsonNode expected,
      System.Text.Json.Nodes.JsonNode actual)
  {
    Assert.Equal(
        YDocConverterFixtures.Canonicalize(expected),
        YDocConverterFixtures.Canonicalize(actual));
  }
}
