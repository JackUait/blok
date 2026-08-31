using Xunit;
using YDotNet.Document;
using YDotNet.Document.Cells;
using YDotNet.Document.Events;
using YDotNet.Document.Transactions;

namespace Blok.Server.Tests.Collab;

public sealed class YDotNetRuntimeProbeTests
{
  private static readonly byte[] TaggedOrigin = "blok-collab"u8.ToArray();

  [Fact]
  public void ObservesAnUpdateSynchronouslyForAnOriginTaggedWrite()
  {
    using var doc = new Doc();
    var text = doc.Text("content");
    var updates = new List<byte[]>();
    using var subscription = doc.ObserveUpdatesV1(updateEvent => updates.Add(updateEvent.Update));

    using (var transaction = doc.WriteTransaction(TaggedOrigin))
    {
      text.Insert(transaction, 0, "Hello from Blok");
    }

    var update = Assert.Single(updates);
    Assert.NotEmpty(update);
  }

  [Fact]
  public void UpdateEventsCarryNoOriginSoEchoSuppressionMustUseAnApplyingRemoteFlag()
  {
    Assert.Null(typeof(UpdateEvent).GetProperty("Origin"));

    var property = Assert.Single(typeof(UpdateEvent).GetProperties());
    Assert.Equal("Update", property.Name);
  }

  [Fact]
  public void StateVectorAndDiffRoundTripConvergeASecondDoc()
  {
    using var source = new Doc();
    var sourceText = source.Text("content");
    var sourceMeta = source.Map("meta");

    using (var transaction = source.WriteTransaction(TaggedOrigin))
    {
      sourceText.Insert(transaction, 0, "Hello from Blok");
      sourceMeta.Insert(transaction, "kind", Input.String("paragraph"));
    }

    using var replica = new Doc();
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

    var replicaText = replica.Text("content");
    var replicaMeta = replica.Map("meta");

    using var sourceTransaction = source.ReadTransaction();
    using var replicaTransaction = replica.ReadTransaction();
    Assert.Equal("Hello from Blok", replicaText.String(replicaTransaction));
    Assert.Equal("paragraph", replicaMeta.Get(replicaTransaction, "kind")?.String);
    Assert.Equal(sourceTransaction.StateVectorV1(), replicaTransaction.StateVectorV1());
  }

  [Fact]
  public void RemotelyCreatedRootsResolveThroughDocTextNotTransactionGetText()
  {
    using var source = new Doc();
    var sourceText = source.Text("content");

    using (var transaction = source.WriteTransaction(TaggedOrigin))
    {
      sourceText.Insert(transaction, 0, "synced");
    }

    using var replica = new Doc();
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

    using (var transaction = replica.ReadTransaction())
    {
      Assert.Null(transaction.GetText("content"));
    }

    var replicaText = replica.Text("content");

    using (var transaction = replica.ReadTransaction())
    {
      Assert.Equal("synced", replicaText.String(transaction));
    }
  }
}
