using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The room's timers and limits, read from the C# types (private constants
/// by reflection) into fixtures/collab-room-constants.json. The Go room
/// asserts the same values (internal/collab/room/constants_test.go), so a
/// change on one side fails until the other follows. Durations are in
/// milliseconds. Set BLOK_WRITE_COLLAB_CONSTANTS=1 to rewrite the file.
/// </summary>
public sealed class CollabRoomConstantsCaptureTests
{
  [Fact]
  public void TheConstantsMatchTheRoom()
  {
    var options = new CollabRoomOptions();
    var wide = new CollabRoomOptions { RetryBackoffCap = TimeSpan.FromDays(10) };
    var backoff = new JsonArray();
    var backoffWide = new JsonArray();

    for (var failures = 0; failures <= 20; failures++)
    {
      backoff.Add(Milliseconds(options.Backoff(failures)));
      backoffWide.Add(Milliseconds(wide.Backoff(failures)));
    }

    var built = new JsonObject
    {
      ["$comment"] = "CollabRoom, CollabRoomManager, CollabRoomOptions and CollabVersionTimeline as C# holds them. Captured by CollabRoomConstantsCaptureTests; do not edit by hand. Durations are milliseconds; backoff is Backoff(0..20), then the same with a 10 day cap.",
      ["exportDebounce"] = Milliseconds(options.ExportDebounce),
      ["exportMaxDelay"] = Milliseconds(options.ExportMaxDelay),
      ["evictionLinger"] = Milliseconds(options.EvictionLinger),
      ["compactionFrameThreshold"] = options.CompactionFrameThreshold,
      ["compactionByteThreshold"] = options.CompactionByteThreshold,
      ["checkpointOperationThreshold"] = options.CheckpointOperationThreshold,
      ["checkpointByteThreshold"] = options.CheckpointByteThreshold,
      ["maxAwarenessClients"] = options.MaxAwarenessClients,
      ["retryBackoff"] = Milliseconds(options.RetryBackoff),
      ["retryBackoffCap"] = Milliseconds(options.RetryBackoffCap),
      ["commitTimeout"] = Milliseconds(options.CommitTimeout),
      ["backoff"] = backoff,
      ["backoffUnderATenDayCap"] = backoffWide,
      ["malformedAwarenessLimit"] = Constant<int>(typeof(CollabRoom), "MalformedAwarenessLimit"),
      ["checkpointFailureLimit"] = Constant<int>(typeof(CollabRoom), "CheckpointFailureLimit"),
      ["transientExportFailureLimit"] = Constant<int>(typeof(CollabRoom), "TransientExportFailureLimit"),
      ["activityWindow"] = Milliseconds(Constant<TimeSpan>(typeof(CollabRoom), "ActivityWindow")),
      ["activityQueueLimit"] = Constant<int>(typeof(CollabRoom), "ActivityQueueLimit"),
      ["activityStampLimit"] = CollabRoom.ActivityStampLimit,
      ["maxJoinAttempts"] = Constant<int>(typeof(CollabRoomManager), "MaxJoinAttempts"),
      ["maxChangeRecords"] = CollabRoomManager.MaxChangeRecords,
      ["maxChangeBytes"] = CollabRoomManager.MaxChangeBytes,
      ["timelineIdleGap"] = Milliseconds(CollabVersionTimeline.IdleGap),
      ["timelineMaxSpan"] = Milliseconds(CollabVersionTimeline.MaxSpan),
    };
    var path = RichTextFixtures.PathOf("collab-room-constants.json");
    var text = built.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_CONSTANTS") == "1")
    {
      File.WriteAllText(path, text);
    }

    Assert.True(File.Exists(path), "collab-room-constants.json is missing; run with BLOK_WRITE_COLLAB_CONSTANTS=1");
    Assert.Equal(text, File.ReadAllText(path));
  }

  private static long Milliseconds(TimeSpan span) =>
      span.Ticks / TimeSpan.TicksPerMillisecond;

  private static T Constant<T>(Type type, string name)
  {
    var field = type.GetField(name, BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Static)
        ?? throw new MissingFieldException(type.Name, name);

    return (T)(field.IsLiteral ? field.GetRawConstantValue()! : field.GetValue(null)!);
  }
}
