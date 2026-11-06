using Blok.Server.Mcp.Live;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class LiveOutboxTests
{
  [Fact]
  public async Task AWriteWithNoRowsIsAckedWithNoSequence()
  {
    var fate = await new LiveOutbox().WaitForAsync([], new LiveLoop(), TimeSpan.FromSeconds(10), CancellationToken.None);

    Assert.Equal(new BatchDelivery.Acked(null), fate);
  }

  [Fact]
  public async Task AFinalQuarantineDropsTheSessionSoTheNextAppendFails()
  {
    var outbox = new LiveOutbox();

    outbox.RecordSession("0123456789abcdef0123456789abcdef", 2, "v2");
    var row = outbox.AppendLocal([1, 2, 3]);
    var waiting = outbox.WaitForAsync([row.OperationId], new LiveLoop(), TimeSpan.FromSeconds(10), CancellationToken.None);

    outbox.QuarantineLineage(row.Lineage, "invalid-update");

    Assert.Equal(new BatchDelivery.Quarantined("invalid-update"), await waiting);
    Assert.Throws<InvalidOperationException>(() => outbox.AppendLocal([4]));
  }
}
