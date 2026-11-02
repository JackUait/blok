using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The on-disk codecs, captured from C# into fixtures/collab-disk/codecs.json.
/// The Go server reads and writes the same journal directories, so Go must
/// encode every case to these exact bytes and decode every broken one to the
/// same status and message (internal/collab/journal and workingset tests).
/// Set BLOK_WRITE_COLLAB_DISK=1 to rewrite the file after an intended change.
/// </summary>
public sealed class CollabDiskCaptureTests
{
  private const string FileName = "collab-disk/codecs.json";
  private const string OperationId = "0123456789abcdef0123456789abcdef";
  private const string Lineage = "fedcba9876543210fedcba9876543210";

  private static readonly byte[] Digest = SHA256.HashData("digest"u8);

  [Fact]
  public void TheCaptureMatchesTheCodecs()
  {
    var built = Build().ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
    var path = RichTextFixtures.PathOf(FileName);

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_COLLAB_DISK") == "1")
    {
      Directory.CreateDirectory(Path.GetDirectoryName(path)!);
      File.WriteAllText(path, built);
    }

    Assert.True(File.Exists(path), $"{FileName} is missing; run with BLOK_WRITE_COLLAB_DISK=1");
    Assert.Equal(built, File.ReadAllText(path));
  }

  private static JsonObject Build()
  {
    return new JsonObject
    {
      ["$comment"] = "Captured from C# by CollabDiskCaptureTests. Do not edit by hand. Ticks and sequences are strings: they do not fit a double.",
      ["docKeys"] = DocKeys(),
      ["workingSet"] = WorkingSet(),
      ["journal"] = Journal(),
      ["ledger"] = Ledger(),
      ["manifest"] = ManifestCases(),
      ["sealed"] = SealedCases(),
    };
  }

  private static JsonArray DocKeys()
  {
    var keys = new JsonArray();

    foreach (var docId in new[] { "a", "doc-1", "é", "😀", "a/b", "A", " " })
    {
      keys.Add(new JsonObject { ["docId"] = docId, ["key"] = CollabDocKey.For(docId) });
    }

    return keys;
  }

  private static JsonObject WorkingSet()
  {
    var encode = new JsonArray();
    var cases = new (int Format, long Epoch, string Lineage, byte[][] Frames)[]
    {
      (1, 0, Lineage, []),
      (2, 5, "00000000000000000000000000000000", [[1, 2, 3], [0xff]]),
      (int.MaxValue, long.MaxValue, "ffffffffffffffffffffffffffffffff", [new byte[300]]),
    };

    foreach (var (format, epoch, lineage, frames) in cases)
    {
      var tag = new CollabWorkingSetTag(format, epoch, lineage);
      encode.Add(new JsonObject
      {
        ["format"] = format,
        ["epoch"] = epoch.ToString(CultureInfo.InvariantCulture),
        ["lineage"] = lineage,
        ["frames"] = new JsonArray(frames.Select(frame => (JsonNode)Hex(frame)).ToArray()),
        ["hex"] = Hex(CollabWorkingSetCodec.EncodeDocument(tag, CollabWorkingSetCodec.EncodeFrames(frames))),
      });
    }

    var good = CollabWorkingSetCodec.EncodeDocument(
        new CollabWorkingSetTag(2, 1, Lineage),
        CollabWorkingSetCodec.EncodeFrames([[7, 8]]));
    var header = good[..CollabWorkingSetCodec.HeaderLength];
    var refused = new JsonArray();

    void Refuse(string name, byte[] document)
    {
      Assert.False(CollabWorkingSetCodec.TryDecodeDocument(document, out _, out _, out var error));
      refused.Add(new JsonObject
      {
        ["name"] = name,
        ["hex"] = Hex(document),
        ["error"] = error,
        ["log"] = CaptureLog("doc-1", document),
      });
    }

    Refuse("empty", []);
    Refuse("header one byte short", header[..^1]);
    Refuse("pre-lineage magic", Patch(header, 0, "BKWS"u8.ToArray()));
    Refuse("format zero", Patch(header, 4, Int32(0)));
    Refuse("format negative", Patch(header, 4, Int32(-1)));
    Refuse("epoch negative", Patch(header, 8, Int64(-1)));
    Refuse("frame prefix truncated", [.. header, 1, 0, 0]);
    Refuse("frame length zero", [.. header, 0, 0, 0, 0]);
    Refuse("frame length negative", [.. header, .. Int32(-1), 1]);
    Refuse("frame body truncated", good[..^1]);
    Refuse("frame length past the end", [.. header, .. Int32(5), 1, 2, 3, 4]);

    return new JsonObject
    {
      ["encode"] = encode,
      ["refused"] = refused,
      ["encodeRefusals"] = new JsonArray(
          new JsonObject { ["format"] = 0, ["epoch"] = "0", ["lineage"] = Lineage, ["frames"] = new JsonArray() },
          new JsonObject { ["format"] = 1, ["epoch"] = "-1", ["lineage"] = Lineage, ["frames"] = new JsonArray() },
          new JsonObject { ["format"] = 1, ["epoch"] = "0", ["lineage"] = Lineage.ToUpperInvariant(), ["frames"] = new JsonArray() },
          new JsonObject { ["format"] = 1, ["epoch"] = "0", ["lineage"] = Lineage[..31], ["frames"] = new JsonArray() },
          new JsonObject { ["format"] = 1, ["epoch"] = "0", ["lineage"] = "", ["frames"] = new JsonArray() },
          new JsonObject { ["format"] = 1, ["epoch"] = "0", ["lineage"] = Lineage, ["frames"] = new JsonArray("") }),
      ["law"] = Law(),
    };
  }

  private static JsonNode? CaptureLog(string docId, byte[] document)
  {
    string? logged = null;
    Assert.Null(CollabWorkingSetLaw.DecodeOrAbsent(docId, document, message => logged = message));

    return logged;
  }

  private static JsonArray Law()
  {
    var law = new JsonArray();

    foreach (var (stored, next) in new (long, long)[] { (3, 2), (3, 3), (3, 4), (0, 0), (long.MaxValue, 0) })
    {
      var set = new CollabWorkingSet([], new CollabWorkingSetTag(2, stored, Lineage));
      var tag = new CollabWorkingSetTag(2, next, Lineage);
      law.Add(new JsonObject
      {
        ["stored"] = stored.ToString(CultureInfo.InvariantCulture),
        ["next"] = next.ToString(CultureInfo.InvariantCulture),
        ["write"] = Message(() => CollabWorkingSetLaw.EnsureWriteDoesNotLowerEpoch("doc \"1\"", set, tag)),
        ["reset"] = Message(() => CollabWorkingSetLaw.EnsureResetRaisesEpoch("doc \"1\"", set, tag)),
      });
    }

    return law;
  }

  private static JsonNode? Message(Action action)
  {
    try
    {
      action();

      return null;
    }
    catch (InvalidOperationException error)
    {
      return error.Message;
    }
  }

  private static JsonObject Journal()
  {
    var encode = new JsonArray();
    var records = new[]
    {
      new CollabOperationRecord(OperationId, 1, new DateTimeOffset(0, TimeSpan.Zero), null, CollabOperationSource.ClientV2, new byte[] { 0 }, Digest),
      new CollabOperationRecord(OperationId, ulong.MaxValue, DateTimeOffset.MaxValue, "alice", CollabOperationSource.ClientV1, new byte[] { 1, 2, 3 }, Digest),
      new CollabOperationRecord("ffffffffffffffffffffffffffffffff", 42, new DateTimeOffset(2026, 10, 31, 12, 34, 56, 789, TimeSpan.Zero).AddTicks(1234), "", CollabOperationSource.HttpEdit, new byte[64], new byte[32]),
      new CollabOperationRecord(OperationId, 7, new DateTimeOffset(1970, 1, 1, 0, 0, 0, TimeSpan.Zero), "é😀 user", CollabOperationSource.ClientV2, new byte[] { 0xff }, Digest),
    };

    foreach (var record in records)
    {
      encode.Add(new JsonObject
      {
        ["operationId"] = record.OperationId,
        ["sequence"] = record.ServerSequence.ToString(CultureInfo.InvariantCulture),
        ["ticks"] = record.CommittedAt.UtcTicks.ToString(CultureInfo.InvariantCulture),
        ["actor"] = record.ActorId,
        ["source"] = (int)record.Source,
        ["update"] = Hex(record.Update.ToArray()),
        ["digest"] = Hex(record.Digest.ToArray()),
        ["hex"] = Hex(CollabJournalCodec.EncodeRecord(record)),
      });
    }

    var good = CollabJournalCodec.EncodeRecord(records[1]);
    var body = good[38..^32];
    var decoded = new JsonArray();

    void Decode(string name, byte[] input)
    {
      var status = CollabJournalCodec.TryDecodeRecord(input, out var record, out var consumed, out var error);
      decoded.Add(new JsonObject
      {
        ["name"] = name,
        ["hex"] = Hex(input),
        ["status"] = status.ToString(),
        ["consumed"] = consumed,
        ["error"] = error,
        ["sequence"] = record?.ServerSequence.ToString(CultureInfo.InvariantCulture),
      });
    }

    Decode("two records back to back", [.. good, .. CollabJournalCodec.EncodeRecord(records[0])]);
    Decode("empty", []);
    Decode("header one byte short", good[..37]);
    Decode("body one byte short", good[..^1]);
    Decode("header checksum flipped", Patch(good, 6, [(byte)(good[6] ^ 1)]));
    Decode("body length flipped", Patch(good, 0, [(byte)(good[0] ^ 1)]));
    Decode("version 2", Raw(body.Length + 32, 2, 0, body));
    Decode("version 0", Raw(body.Length + 32, 0, 0, body));
    Decode("source 3", Raw(body.Length + 32, 1, 3, body));
    Decode("source 255", Raw(body.Length + 32, 1, 255, body));
    Decode("body length below the minimum", Raw(16 + 8 + 8 + 4 + 32 + 4 + 32, 1, 0, new byte[16 + 8 + 8 + 4 + 32 + 4]));
    Decode("body length above the maximum", Raw(CollabJournalCodec.MaxBodyLength + 1, 1, 0, [], checksum: false));
    Decode("body length negative", Raw(-1, 1, 0, [], checksum: false));
    Decode("body checksum flipped", Patch(good, good.Length - 1, [(byte)(good[^1] ^ 1)]));
    Decode("sequence zero", Raw(body.Length + 32, 1, 0, Patch(body, 16, Int64(0))));
    Decode("ticks negative", Raw(body.Length + 32, 1, 0, Patch(body, 24, Int64(-1))));
    Decode("ticks past the maximum", Raw(body.Length + 32, 1, 0, Patch(body, 24, Int64(DateTimeOffset.MaxValue.Ticks + 1))));
    Decode("ticks at the maximum", Raw(body.Length + 32, 1, 0, Patch(body, 24, Int64(DateTimeOffset.MaxValue.Ticks))));
    Decode("actor length -2", Raw(body.Length + 32, 1, 0, Patch(body, 32, Int32(-2))));
    Decode("actor length past the body", Raw(body.Length + 32, 1, 0, Patch(body, 32, Int32(4000))));
    Decode("actor length past the cap", Raw(body.Length + 32, 1, 0, Patch(body, 32, Int32(4097))));
    Decode("actor not UTF-8", Raw(body.Length + 32, 1, 0, Patch(body, 36, [0xc3, 0x28, 0x69, 0x63, 0x65])));
    Decode("actor lone surrogate as UTF-8", Raw(body.Length + 32, 1, 0, Patch(body, 36, [0xed, 0xa0, 0x80, 0x63, 0x65])));
    Decode("actor overlong", Raw(body.Length + 32, 1, 0, Patch(body, 36, [0xc0, 0xaf, 0x69, 0x63, 0x65])));

    // A null actor, then the fields after it, built by hand.
    var fixedPart = body[..32];
    // The actor eats the space the digest or the update length needed.
    Decode("digest truncated", Raw(32 + 4 + 37 + 32, 1, 0, [.. fixedPart, .. Int32(37), .. Enumerable.Repeat((byte)'a', 37)]));
    Decode("update length missing", Raw(32 + 4 + 5 + 32 + 32, 1, 0, [.. fixedPart, .. Int32(5), .. Enumerable.Repeat((byte)'a', 5), .. Digest]));
    Decode("update length zero", Raw(32 + 4 + 32 + 4 + 1 + 32, 1, 0, [.. fixedPart, .. Int32(-1), .. Digest, .. Int32(0), 9]));
    Decode("update length past the body", Raw(32 + 4 + 32 + 4 + 1 + 32, 1, 0, [.. fixedPart, .. Int32(-1), .. Digest, .. Int32(2), 9]));
    Decode("update length past the cap", Raw(32 + 4 + 32 + 4 + 1 + 32, 1, 0, [.. fixedPart, .. Int32(-1), .. Digest, .. Int32(CollabJournalCodec.MaxUpdateLength + 1), 9]));
    Decode("trailing bytes in the body", Raw(32 + 4 + 32 + 4 + 3 + 32, 1, 0, [.. fixedPart, .. Int32(-1), .. Digest, .. Int32(1), 9, 8, 7]));
    Decode("honest header, little body", [.. Header(1_000_000, 1, 0), .. new byte[10]]);

    return new JsonObject { ["encode"] = encode, ["decode"] = decoded };
  }

  private static JsonObject Ledger()
  {
    var entries = new[]
    {
      new CollabLineageEntry(CollabLineageEntryKind.Published, 1, 0, Lineage, 0, 2, new DateTimeOffset(2026, 10, 31, 0, 0, 0, TimeSpan.Zero).AddTicks(5)),
      new CollabLineageEntry(CollabLineageEntryKind.Deleted, ulong.MaxValue, ulong.MaxValue, "00000000000000000000000000000000", long.MaxValue, int.MaxValue, null),
      new CollabLineageEntry(CollabLineageEntryKind.Published, 2, 3, Lineage, -1, -5, DateTimeOffset.MinValue),
      new CollabLineageEntry(CollabLineageEntryKind.Published, 2, 3, Lineage, 4, 1, DateTimeOffset.MaxValue),
    };
    var encode = new JsonArray();

    foreach (var entry in entries)
    {
      encode.Add(new JsonObject
      {
        ["kind"] = (int)entry.Kind,
        ["generation"] = entry.Generation.ToString(CultureInfo.InvariantCulture),
        ["generationFence"] = entry.GenerationFence.ToString(CultureInfo.InvariantCulture),
        ["lineage"] = entry.Lineage,
        ["epoch"] = entry.Epoch.ToString(CultureInfo.InvariantCulture),
        ["format"] = entry.Format,
        ["ticks"] = entry.CreatedAt?.UtcTicks.ToString(CultureInfo.InvariantCulture),
        ["hex"] = Hex(CollabLineageLedger.Encode(entry)),
      });
    }

    var good = CollabLineageLedger.Encode(entries[0]);
    var refused = new JsonArray();

    void Refuse(string name, byte[] slot)
    {
      Assert.False(CollabLineageLedger.TryDecode(slot, out _));
      refused.Add(new JsonObject { ["name"] = name, ["hex"] = Hex(slot) });
    }

    Refuse("short", good[..^1]);
    Refuse("long", [.. good, 0]);
    Refuse("checksum flipped", Patch(good, 60, [(byte)(good[60] ^ 1)]));
    Refuse("kind 0", Sealed(Patch(good, 0, [0])));
    Refuse("kind 3", Sealed(Patch(good, 0, [3])));
    Refuse("ticks negative", Sealed(Patch(good, 45, Int64(-1))));
    Refuse("ticks past the maximum", Sealed(Patch(good, 45, Int64(DateTime.MaxValue.Ticks + 1))));

    // One file: good, bad, good, then a torn tail. Read skips the bad entry and the tail.
    var file = new byte[][] { good, Patch(good, 60, [(byte)(good[60] ^ 1)]), CollabLineageLedger.Encode(entries[1]), good[..10] }
        .SelectMany(part => part)
        .ToArray();
    var directory = Directory.CreateTempSubdirectory("blok-ledger-");

    try
    {
      var path = Path.Combine(directory.FullName, CollabLineageLedger.FileName);
      File.WriteAllBytes(path, file);
      var warnings = new List<string>();
      var read = CollabLineageLedger.Read(path, warnings.Add);

      return new JsonObject
      {
        ["encode"] = encode,
        ["refused"] = refused,
        ["file"] = new JsonObject
        {
          ["hex"] = Hex(file),
          ["generations"] = new JsonArray(read.Select(entry => (JsonNode)entry.Generation.ToString(CultureInfo.InvariantCulture)).ToArray()),
          ["warnings"] = new JsonArray(warnings.Select(warning => (JsonNode)warning.Replace(path, "{path}")).ToArray()),
        },
      };
    }
    finally
    {
      directory.Delete(recursive: true);
    }
  }

  private static JsonObject ManifestCases()
  {
    var manifests = new[]
    {
      new LocalCollabOperationStore.Manifest(1, 2, 3, true, 2, 4, Lineage, 5, 6, 7),
      new LocalCollabOperationStore.Manifest(2, 0, 0, false, 0, 0, "00000000000000000000000000000000", 0, 0, 0),
      new LocalCollabOperationStore.Manifest(ulong.MaxValue, ulong.MaxValue, ulong.MaxValue, true, int.MinValue, long.MinValue, "ffffffffffffffffffffffffffffffff", ulong.MaxValue, ulong.MaxValue, ulong.MaxValue),
    };
    var encode = new JsonArray();

    foreach (var manifest in manifests)
    {
      var slot = new byte[LocalCollabOperationStore.ManifestSlotSize];
      LocalCollabOperationStore.EncodeSlot(manifest, slot);
      var entry = Describe(manifest);
      entry["hex"] = Hex(slot);
      encode.Add(entry);
    }

    byte[] Slot(LocalCollabOperationStore.Manifest manifest)
    {
      var slot = new byte[LocalCollabOperationStore.ManifestSlotSize];
      LocalCollabOperationStore.EncodeSlot(manifest, slot);

      return slot;
    }

    var older = Slot(manifests[0]);
    var newer = Slot(manifests[1]);
    var corrupt = Patch(older, 20, [(byte)(older[20] ^ 1)]);
    var foreign = Patch(older, 4, [3]);
    var foreignHash = SHA256.HashData(foreign.AsSpan(0, 96));
    foreignHash.CopyTo(foreign, 96);
    var badMagic = Patch(older, 0, "BKJX"u8.ToArray());
    var reads = new JsonArray();
    var directory = Directory.CreateTempSubdirectory("blok-manifest-");

    void Read(string name, byte[] file)
    {
      var path = Path.Combine(directory.FullName, "manifest");
      File.WriteAllBytes(path, file);
      var read = new JsonObject { ["name"] = name, ["hex"] = Hex(file) };

      try
      {
        var manifest = LocalCollabOperationStore.ReadManifest(path, "doc-1");
        read["manifest"] = manifest is { } found ? Describe(found) : null;
      }
      catch (InvalidDataException error)
      {
        read["error"] = error.Message;
      }

      reads.Add(read);
    }

    try
    {
      Read("empty", []);
      Read("both slots, second newer", [.. older, .. newer]);
      Read("both slots, first newer", [.. newer, .. older]);
      Read("equal counters keep the first", [.. older, .. Slot(manifests[0] with { Fence = 9 })]);
      Read("first slot corrupt", [.. corrupt, .. newer]);
      Read("second slot corrupt", [.. older, .. corrupt]);
      Read("bad magic", [.. badMagic, .. newer]);
      Read("both corrupt", [.. corrupt, .. corrupt]);
      Read("foreign version beside a good slot", [.. foreign, .. newer]);
      Read("foreign version only", [.. foreign, .. corrupt]);
      Read("one byte short", [.. older, .. newer[..^1]]);
      Read("one slot", older);
      Read("zeroes", new byte[LocalCollabOperationStore.ManifestSize]);
    }
    finally
    {
      directory.Delete(recursive: true);
    }

    return new JsonObject { ["encode"] = encode, ["read"] = reads };
  }

  private static JsonObject Describe(LocalCollabOperationStore.Manifest manifest)
  {
    static JsonNode U(ulong value) => value.ToString(CultureInfo.InvariantCulture);

    return new JsonObject
    {
      ["writeCounter"] = U(manifest.WriteCounter),
      ["fence"] = U(manifest.Fence),
      ["generation"] = U(manifest.Generation),
      ["seeded"] = manifest.Seeded,
      ["format"] = manifest.Format,
      ["epoch"] = manifest.Epoch.ToString(CultureInfo.InvariantCulture),
      ["lineage"] = manifest.Lineage,
      ["checkpointThrough"] = U(manifest.CheckpointThrough),
      ["generationFence"] = U(manifest.GenerationFence),
      ["checkpointFence"] = U(manifest.CheckpointFence),
    };
  }

  private static JsonObject SealedCases()
  {
    var directory = Directory.CreateTempSubdirectory("blok-sealed-");

    try
    {
      var encode = new JsonArray();

      void Write(string fileName, byte[] magic, ulong tag, byte[] content)
      {
        var path = Path.Combine(directory.FullName, fileName);
        LocalCollabOperationStore.WriteSealed(path, magic, tag, content);
        encode.Add(new JsonObject
        {
          ["magic"] = Encoding.ASCII.GetString(magic),
          ["tag"] = tag.ToString(CultureInfo.InvariantCulture),
          ["content"] = Hex(content),
          ["hex"] = Hex(File.ReadAllBytes(path)),
        });
      }

      Write("baseline.1.0", "BKJB"u8.ToArray(), 0, [1, 0, 0, 0, 7]);
      Write("checkpoint.1.5.2", "BKJC"u8.ToArray(), 5, [0, 0]);
      Write("checkpoint.1.9.2", "BKJC"u8.ToArray(), ulong.MaxValue, []);

      var good = File.ReadAllBytes(Path.Combine(directory.FullName, "checkpoint.1.5.2"));
      var reads = new JsonArray();

      void Read(string name, byte[]? file, string magic = "BKJC")
      {
        var fileName = "checkpoint.1.5.2";
        var path = Path.Combine(directory.FullName, fileName);
        File.Delete(path);

        if (file is not null)
        {
          File.WriteAllBytes(path, file);
        }

        var read = new JsonObject { ["name"] = name, ["fileName"] = fileName, ["magic"] = magic, ["hex"] = file is null ? null : Hex(file) };

        try
        {
          var content = LocalCollabOperationStore.ReadSealed(path, Encoding.ASCII.GetBytes(magic), "doc-1", out var tag);
          read["tag"] = tag.ToString(CultureInfo.InvariantCulture);
          read["content"] = Hex(content);
        }
        catch (InvalidDataException error)
        {
          read["error"] = error.Message;
        }

        reads.Add(read);
      }

      Read("good", good);
      Read("missing", null);
      Read("other magic", good, "BKJB");
      Read("short", good[..55]);
      Read("version 2", Patch(good, 4, [2]));
      Read("length one more", Patch(good, 16, Int64(3)));
      Read("length negative", Patch(good, 16, Int64(-1)));
      Read("checksum flipped", Patch(good, good.Length - 1, [(byte)(good[^1] ^ 1)]));
      Read("content flipped", Patch(good, 24, [1]));
      Read("trailing byte", [.. good, 0]);

      return new JsonObject { ["encode"] = encode, ["read"] = reads };
    }
    finally
    {
      directory.Delete(recursive: true);
    }
  }

  private static byte[] Sealed(byte[] slot)
  {
    var hash = SHA256.HashData(slot.AsSpan(0, 53));
    hash[..8].CopyTo(slot, 53);

    return slot;
  }

  private static byte[] Header(int bodyLength, byte version, byte source)
  {
    var header = new byte[38];
    BinaryPrimitives.WriteInt32LittleEndian(header, bodyLength);
    header[4] = version;
    header[5] = source;
    SHA256.HashData(header.AsSpan(0, 6), header.AsSpan(6, 32));

    return header;
  }

  /// <summary>A header for <paramref name="bodyLength"/>, then the content and its checksum.</summary>
  private static byte[] Raw(int bodyLength, byte version, byte source, byte[] content, bool checksum = true)
  {
    return checksum ? [.. Header(bodyLength, version, source), .. content, .. SHA256.HashData(content)] : Header(bodyLength, version, source);
  }

  private static byte[] Patch(byte[] source, int offset, byte[] replacement)
  {
    var copy = source.ToArray();
    replacement.CopyTo(copy, offset);

    return copy;
  }

  private static byte[] Int32(int value)
  {
    var bytes = new byte[4];
    BinaryPrimitives.WriteInt32LittleEndian(bytes, value);

    return bytes;
  }

  private static byte[] Int64(long value)
  {
    var bytes = new byte[8];
    BinaryPrimitives.WriteInt64LittleEndian(bytes, value);

    return bytes;
  }

  private static string Hex(byte[] bytes)
  {
    return Convert.ToHexStringLower(bytes);
  }
}
