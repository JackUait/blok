using System.Buffers.Binary;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Blok.Server.Collab;

/// <summary>
/// The built-in <see cref="ICollabOperationStore"/>: one append-only,
/// checksummed journal per document, under a directory of its own.
/// </summary>
/// <remarks>
/// <para>
/// LAYOUT. <c>&lt;directory&gt;/&lt;CollabDocKey&gt;.journal/</c> holds
/// <c>lock</c>, <c>manifest</c>,
/// <c>journal.&lt;generation&gt;.&lt;mintingFence&gt;</c>,
/// <c>baseline.&lt;generation&gt;.&lt;mintingFence&gt;</c> and
/// <c>checkpoint.&lt;generation&gt;.&lt;through&gt;.&lt;writingFence&gt;</c>.
/// The manifest publication that names a generation is the single step that
/// switches lineages, so a file the manifest does not mention yet is inert.
/// </para>
/// <para>
/// THE FENCE IN EACH NAME IS WHAT MAKES A RESET SAFE, and the generation is
/// not. This paragraph once said the opposite — that naming per-lineage files
/// after the generation alone made a reset atomic, every file being written
/// under its final name exactly once — and that belief is precisely what put a
/// data-loss bug in <c>ResetAsync</c>. The generation is
/// <c>current + 1</c>, which a NEW holder computes identically: a session that
/// stalled after its fence check resumed to replace the baseline the new
/// holder had published and truncate the journal it had already acknowledged
/// operations into. No check-then-act guard closes that, because the stall can
/// happen after the check. Two holders never share a fence, so putting it in
/// the name removes the collision instead of narrowing it.
/// </para>
/// <para>
/// "Written exactly once" is therefore also false, and deliberately so: a
/// RETRIED reset runs at the same fence and generation and so rewrites its own
/// names, which is why <c>SetLength(0)</c> and <c>FileMode.Create</c> still
/// have to be there. What is true is that a name can only ever be rewritten by
/// the session that first wrote it.
/// </para>
/// <para>
/// THE <c>.journal</c> SUFFIX IS LOAD-BEARING, and it is why this store shares
/// one collab directory with <see cref="LocalCollabStore"/> instead of needing
/// its own. That store keeps today's whole-document file at
/// <c>&lt;dir&gt;/&lt;CollabDocKey&gt;</c>, and no filesystem lets a directory
/// share a name with a file — so an unsuffixed per-document directory would
/// throw for every document that already has a working set, and migration
/// would have nowhere to read the old bytes from. With the suffix the two sit
/// side by side under one configured path, which is also what keeps
/// one-process-per-directory covering both.
/// </para>
/// <para>
/// THIS STORE MUST OPEN A DOCUMENT BEFORE ANYTHING READS IT THROUGH
/// <see cref="LocalCollabStore"/>. Importing a working set that does not
/// decode fails closed rather than seeding an empty document — but
/// <c>LocalCollabStore.ReadAsync</c> MOVES an unreadable file aside, and after
/// that rename the import sees no file, seeds empty, and the user's damaged
/// document is replaced by a blank one on the first edit. Nothing consumes
/// this store yet, which is the only reason the ordering is free today.
/// </para>
/// <para>
/// THE ACKNOWLEDGEMENT BOUNDARY IS ONE FLUSH. An append writes its record to a
/// journal file whose directory entry is already durable, then calls
/// <c>Flush(flushToDisk: true)</c>. Nothing else is written — not the manifest,
/// not a separate index — so there is no second write whose loss could strand a
/// record, and no directory sync is involved, which is what keeps the boundary
/// honest on Windows, where no directory sync exists.
/// </para>
/// <para>
/// THE FENCE IS THE MECHANISM; THE LOCK IS AN OPTIMISATION. The lock file
/// decides LIVENESS only — the kernel drops it when the process ends, so a dead
/// holder is reclaimable and a live one is refused. It cannot decide
/// correctness: it is advisory, it dies with its inode the moment the file is
/// unlinked, and a holder with a stale descriptor still reaches the bytes. Every
/// append, checkpoint and reset therefore re-reads the manifest from its path
/// and compares the fence before writing anything, and an append compares it
/// again after the flush.
/// </para>
/// <para>
/// ONE PROCESS PER DIRECTORY. Two processes never write one document at once
/// because the second is refused, and the fence catches the case where the
/// first's hold has evaporated. Nothing here makes several writers safe.
/// </para>
/// </remarks>
internal sealed class LocalCollabOperationStore : ICollabOperationStore
{
  /// <summary>
  /// Matches the default <c>CollabMaxMessageBytes</c>. The codec's own 32 MiB
  /// ceiling is a backstop against an absurd allocation, not the policy: the
  /// server's configured wire limit is.
  /// </summary>
  internal const long DefaultMaxUpdateBytes = 1 << 20;

  private const string LockName = "lock";
  private const string ManifestName = "manifest";

  // Distinguishes the journal directory from LocalCollabStore's whole-document
  // file, which sits at the unsuffixed key in the same directory.
  private const string JournalDirectorySuffix = ".journal";

  // open(2) O_RDONLY; the same value on Linux and macOS.
  private const int ReadOnlyFlags = 0;

  private const byte ManifestVersion = 2;
  private const int ManifestSlotSize = 128;
  private const int ManifestSlotContentSize = 96;
  private const int ManifestSize = ManifestSlotSize * 2;

  private const byte SealedVersion = 1;
  private const int SealedHeaderSize = 24;
  private const int ChecksumSize = 32;

  private static readonly UnixFileMode PrivateFileMode =
      UnixFileMode.UserRead | UnixFileMode.UserWrite;
  private static readonly UnixFileMode PrivateDirectoryMode =
      UnixFileMode.UserRead |
      UnixFileMode.UserWrite |
      UnixFileMode.UserExecute;

  private readonly string directory;
  private readonly long maxUpdateBytes;
  private readonly Action<string>? log;

  internal LocalCollabOperationStore(
      string directory,
      long maxUpdateBytes = DefaultMaxUpdateBytes,
      Action<string>? log = null)
  {
    ArgumentException.ThrowIfNullOrEmpty(directory);
    ArgumentOutOfRangeException.ThrowIfLessThan(maxUpdateBytes, 1);

    // Refused at construction, not at the first oversized append: a limit the
    // record format cannot carry is a misconfiguration, and discovering it from
    // an EncodeRecord throw mid-session makes it look like a data problem.
    ArgumentOutOfRangeException.ThrowIfGreaterThan(
        maxUpdateBytes,
        CollabJournalCodec.MaxUpdateLength);

    this.directory = directory;
    this.maxUpdateBytes = maxUpdateBytes;
    this.log = log;
  }

  private static ReadOnlySpan<byte> ManifestMagic => "BKJM"u8;

  private static ReadOnlySpan<byte> BaselineMagic => "BKJB"u8;

  private static ReadOnlySpan<byte> CheckpointMagic => "BKJC"u8;

  public ValueTask<CollabDocumentOpen> OpenAsync(
      string documentId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(documentId);
    cancellationToken.ThrowIfCancellationRequested();

    return ValueTask.FromResult(Open(documentId));
  }

  private CollabDocumentOpen Open(string documentId)
  {
    var docDirectory = Path.Combine(
        directory,
        CollabDocKey.For(documentId) + JournalDirectorySuffix);
    EnsureDirectory(docDirectory);

    FileStream? hold = null;
    FileStream? manifestFile = null;
    FileStream? journal = null;

    try
    {
      hold = TryHold(Path.Combine(docDirectory, LockName), out var refusal);

      if (hold is null)
      {
        // .NET's HResult for a lock conflict is the raw errno on Unix, which
        // differs per platform, so a disk fault that also throws IOException
        // cannot be told apart from a live holder here. The reason is logged
        // rather than swallowed, so an operator is not left guessing.
        log?.Invoke($"collab: \"{documentId}\" is held elsewhere: {refusal}");

        return CollabDocumentOpen.DocumentOpenElsewhere;
      }

      var manifestPath = Path.Combine(docDirectory, ManifestName);
      var stored = ReadManifest(manifestPath, documentId);

      if (stored is null && Directory.GetFiles(docDirectory, "journal.*").Length > 0)
      {
        throw new InvalidDataException(
            $"collab: \"{documentId}\" has journal files but no manifest naming their " +
            "lineage; refusing to treat it as an unseeded document.");
      }

      var current = stored ?? Manifest.Unseeded;
      manifestFile = OpenManifest(manifestPath);

      // The fence is taken BEFORE recovery touches a byte, so a holder that is
      // still alive is refused by its own next fence check rather than racing
      // this session's truncation of a torn tail.
      var fenced = current with
      {
        WriteCounter = current.WriteCounter + 1,
        Fence = current.Fence + 1,
      };
      Publish(manifestFile, fenced);

      if (stored is null)
      {
        // The manifest's directory entry is new. Every later publication writes
        // in place, so this is the only publication that needs the directory.
        SyncDirectory(docDirectory);
      }

      if (!fenced.Seeded)
      {
        fenced = ImportWorkingSet(docDirectory, manifestFile, documentId, fenced);
      }

      var index = new JournalIndex();
      IReadOnlyList<CollabOperationRecord> records = [];
      IReadOnlyList<ReadOnlyMemory<byte>> baseline = [];
      CollabOperationCheckpoint? checkpoint = null;

      if (fenced.Seeded)
      {
        baseline = ReadBaseline(docDirectory, fenced, documentId);

        var journalPath = JournalPath(
            docDirectory,
            fenced.Generation,
            fenced.GenerationFence);

        try
        {
          // FileMode.Open, never OpenOrCreate: creating it would turn "a file
          // is missing, an operator would notice" into "an empty lineage,
          // indistinguishable from a fresh one" — after which this store
          // reassigns sequences that are already taken and answers NotCommitted
          // for committed ids. Asking the OS to open-or-fail is atomic, where
          // checking File.Exists first is not.
          journal = OpenJournal(journalPath, FileMode.Open);
        }
        catch (FileNotFoundException error)
        {
          throw new InvalidDataException(
              $"collab: \"{documentId}\" names {Path.GetFileName(journalPath)}, " +
              "which is not there.",
              error);
        }
        catch (DirectoryNotFoundException error)
        {
          throw new InvalidDataException(
              $"collab: the journal directory for \"{documentId}\" is gone, " +
              $"so {Path.GetFileName(journalPath)} cannot be read.",
              error);
        }
        records = ScanForward(
            journal,
            index,
            documentId,
            () => RequireFence(docDirectory, documentId, fenced));

        if (fenced.CheckpointThrough > index.DurableThrough)
        {
          throw new InvalidDataException(
              $"collab: the manifest for \"{documentId}\" names checkpoint " +
              $"{fenced.CheckpointThrough} but the journal only reaches " +
              $"{index.DurableThrough}.");
        }

        if (fenced.CheckpointThrough > 0)
        {
          checkpoint = ReadCheckpoint(docDirectory, fenced, documentId);
        }
      }

      var head = fenced.Seeded
        ? new CollabDocumentHead(
            fenced.Format,
            fenced.Epoch,
            fenced.Lineage,
            index.DurableThrough)
        : null;
      var openResult = new CollabOperationOpenResult(
          head,
          baseline,
          checkpoint,
          [.. records.Where(record => record.ServerSequence > fenced.CheckpointThrough)]);

      return CollabDocumentOpen.Opened(new Session(
          this,
          documentId,
          docDirectory,
          hold,
          manifestFile,
          journal,
          fenced,
          index,
          openResult));
    }
    catch
    {
      // A refused open releases its hold: a document that fails to recover must
      // report the same failure to the next attempt, not report itself as held
      // somewhere else until the process exits.
      journal?.Dispose();
      manifestFile?.Dispose();
      hold?.Dispose();

      throw;
    }
  }

  /// <summary>
  /// Adopts <see cref="LocalCollabStore"/>'s whole-document file, at the
  /// unsuffixed key in this same directory, as this document's sequence-zero
  /// baseline — keeping its format, epoch, lineage and the exact bytes of its
  /// frame section. A document with no such file is left unseeded for the
  /// caller to seed. Working sets held in any OTHER
  /// <see cref="ICollabWorkingSetStore"/>, S3's included, are not read here.
  /// </summary>
  /// <remarks>
  /// <para>
  /// THE MANIFEST PUBLICATION IS THE WHOLE OF THE MIGRATION, and everything
  /// before it writes files the manifest does not name yet. So a crash at any
  /// earlier step leaves the document exactly as it was — the old file
  /// untouched, the journal directory still unseeded — and the next open
  /// migrates again from the same source. That ordering is also why the old
  /// file is not removed once publication lands: nothing reads it any more,
  /// and leaving it is what makes a half-finished migration cost nothing.
  /// </para>
  /// <para>
  /// A FILE THAT DOES NOT DECODE THROWS, and is never treated as absent the
  /// way <see cref="CollabWorkingSetLaw.DecodeOrAbsent"/> treats it next door.
  /// Absent means unseeded, the caller then seeds an empty document, and the
  /// first edit overwrites the only copy of the user's content with a blank
  /// page. Refusing to open keeps the bytes there to be repaired from.
  /// </para>
  /// </remarks>
  private Manifest ImportWorkingSet(
      string docDirectory,
      FileStream manifestFile,
      string documentId,
      Manifest fenced)
  {
    byte[] document;

    try
    {
      document = File.ReadAllBytes(Path.Combine(directory, CollabDocKey.For(documentId)));
    }
    catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
    {
      return fenced;
    }

    if (!CollabWorkingSetCodec.TryDecodeDocument(
        document,
        out var tag,
        out var frameSection,
        out var reason))
    {
      throw new InvalidDataException(
          $"collab: the working set for \"{documentId}\" is unreadable ({reason}), " +
          "so it cannot be imported; refusing to open the document as a new, empty one.");
    }

    var generation = fenced.Generation + 1;

    // The minting fence is in both names for the same reason it is in
    // ResetAsync's — see the type's remarks. A retry after a crash runs at a
    // new fence and so writes new names; the abandoned attempt's files are
    // left where they are, named after a fence nothing references.
    var mintedBy = fenced.Fence;

    // The frame section is stored exactly as it was read, not re-derived from
    // the frames or reduced to one full-state update.
    WriteSealed(
        BaselinePath(docDirectory, generation, mintedBy),
        BaselineMagic,
        0,
        frameSection);

    using (var journal = OpenJournal(
        JournalPath(docDirectory, generation, mintedBy),
        FileMode.OpenOrCreate))
    {
      // Only ever this session's own abandoned earlier attempt at the same
      // fence and generation, because the name carries both.
      RequireFence(docDirectory, documentId, fenced);
      journal.SetLength(0);
      journal.Flush(flushToDisk: true);
    }

    SyncDirectory(docDirectory);

    var published = fenced with
    {
      WriteCounter = fenced.WriteCounter + 1,
      Generation = generation,
      GenerationFence = mintedBy,
      CheckpointFence = 0,
      Seeded = true,
      Format = tag.Format,
      Epoch = tag.Epoch,
      Lineage = tag.Lineage,
      CheckpointThrough = 0,
    };

    // Re-verified immediately before the slot write, because reading and
    // sealing the old document is not instantaneous: a holder judged dead in
    // that window would have taken the document, and this publication would
    // then overwrite its fence with this session's older one.
    RequireFence(docDirectory, documentId, fenced);
    Publish(manifestFile, published);

    log?.Invoke(
        $"collab: imported the working set for \"{documentId}\" as the baseline of " +
        $"lineage {tag.Lineage} at epoch {tag.Epoch}; the old file is left in place.");

    return published;
  }

  private static string JournalPath(string docDirectory, ulong generation, ulong mintedBy)
  {
    return Path.Combine(
        docDirectory,
        string.Create(CultureInfo.InvariantCulture, $"journal.{generation}.{mintedBy}"));
  }

  private static string BaselinePath(string docDirectory, ulong generation, ulong mintedBy)
  {
    return Path.Combine(
        docDirectory,
        string.Create(CultureInfo.InvariantCulture, $"baseline.{generation}.{mintedBy}"));
  }

  private static string CheckpointPath(
      string docDirectory,
      ulong generation,
      ulong through,
      ulong writtenBy)
  {
    return Path.Combine(
        docDirectory,
        string.Create(
            CultureInfo.InvariantCulture,
            $"checkpoint.{generation}.{through}.{writtenBy}"));
  }

  private void EnsureDirectory(string docDirectory)
  {
    if (Directory.Exists(docDirectory))
    {
      return;
    }

    if (OperatingSystem.IsWindows())
    {
      Directory.CreateDirectory(directory);
      Directory.CreateDirectory(docDirectory);
    }
    else
    {
      Directory.CreateDirectory(directory, PrivateDirectoryMode);
      Directory.CreateDirectory(docDirectory, PrivateDirectoryMode);
    }

    SyncDirectory(directory);
  }

  private static FileStream? TryHold(string lockPath, out string refusal)
  {
    refusal = "";

    try
    {
      return new FileStream(lockPath, CreateOptions(FileAccess.ReadWrite, FileMode.OpenOrCreate, FileShare.None));
    }
    catch (IOException error)
        when (error is not (FileNotFoundException or DirectoryNotFoundException or PathTooLongException))
    {
      refusal = error.Message;

      return null;
    }
  }

  private static FileStream OpenManifest(string path)
  {
    var file = new FileStream(
        path,
        CreateOptions(FileAccess.ReadWrite, FileMode.OpenOrCreate, FileShare.ReadWrite));

    if (file.Length < ManifestSize)
    {
      file.SetLength(ManifestSize);
    }

    return file;
  }

  private static FileStream OpenJournal(string path, FileMode mode)
  {
    return new FileStream(
        path,
        CreateOptions(FileAccess.ReadWrite, mode, FileShare.ReadWrite));
  }

  private static FileStreamOptions CreateOptions(
      FileAccess access,
      FileMode mode,
      FileShare share)
  {
    var options = new FileStreamOptions
    {
      Access = access,
      Mode = mode,
      Share = share,

      // Unbuffered: a record must reach the OS on Write, so the flush that
      // follows is the only thing standing between it and the platter.
      BufferSize = 0,
    };

    // Only for modes that can create: the runtime rejects UnixCreateMode on
    // FileMode.Open, which the recovery path uses so a missing journal fails
    // instead of being conjured empty.
    if (!OperatingSystem.IsWindows() &&
        mode is FileMode.CreateNew or FileMode.Create or FileMode.OpenOrCreate or FileMode.Append)
    {
      options.UnixCreateMode = PrivateFileMode;
    }

    return options;
  }

  /// <summary>
  /// Two self-checksummed slots, written alternately in place. A torn write can
  /// only damage the slot it was writing, so the other still carries the last
  /// published state — which is why publication needs no rename, and therefore
  /// no directory sync, on any platform.
  /// </summary>
  private static void Publish(FileStream manifestFile, Manifest next)
  {
    Span<byte> slot = stackalloc byte[ManifestSlotSize];
    EncodeSlot(next, slot);
    manifestFile.Seek((long)(next.WriteCounter & 1) * ManifestSlotSize, SeekOrigin.Begin);
    manifestFile.Write(slot);
    manifestFile.Flush(flushToDisk: true);
  }

  /// <summary>
  /// Null when the manifest does not exist yet. Throws when it exists and no
  /// slot decodes: a document whose identity is unreadable must not be handed
  /// back as a fresh one.
  /// </summary>
  private static Manifest? ReadManifest(string path, string documentId)
  {
    byte[] bytes;

    try
    {
      bytes = File.ReadAllBytes(path);
    }
    catch (FileNotFoundException)
    {
      return null;
    }
    catch (DirectoryNotFoundException)
    {
      return null;
    }

    if (bytes.Length == 0)
    {
      // Created but never published: a crash between the two.
      return null;
    }

    if (bytes.Length != ManifestSize)
    {
      throw new InvalidDataException(
          $"collab: the manifest for \"{documentId}\" is {bytes.Length} bytes, not {ManifestSize}.");
    }

    Manifest? best = null;
    byte? foreignVersion = null;

    for (var slot = 0; slot < 2; slot++)
    {
      var span = bytes.AsSpan(slot * ManifestSlotSize, ManifestSlotSize);

      switch (TryDecodeSlot(span, out var candidate))
      {
        case ManifestSlotStatus.Ok
            when best is null || candidate.WriteCounter > best.Value.WriteCounter:
          best = candidate;

          break;

        case ManifestSlotStatus.ForeignVersion:
          foreignVersion = span[4];

          break;

        default:
          break;
      }
    }

    if (best is not null)
    {
      return best;
    }

    // Said apart because they call for opposite first moves during an incident:
    // a version this build does not know is a deployment problem, and telling
    // an operator the manifest "does not decode" sends them hunting a disk
    // fault instead.
    throw new InvalidDataException(foreignVersion is { } version
      ? $"collab: the manifest for \"{documentId}\" is version {version}, and " +
        $"this build writes version {ManifestVersion}."
      : $"collab: neither manifest slot for \"{documentId}\" decodes.");
  }

  private static void EncodeSlot(Manifest manifest, Span<byte> slot)
  {
    slot.Clear();
    ManifestMagic.CopyTo(slot);
    slot[4] = ManifestVersion;
    slot[5] = manifest.Seeded ? (byte)1 : (byte)0;
    BinaryPrimitives.WriteUInt64LittleEndian(slot[8..], manifest.WriteCounter);
    BinaryPrimitives.WriteUInt64LittleEndian(slot[16..], manifest.Fence);
    BinaryPrimitives.WriteUInt64LittleEndian(slot[24..], manifest.Generation);
    BinaryPrimitives.WriteInt32LittleEndian(slot[32..], manifest.Format);
    BinaryPrimitives.WriteInt64LittleEndian(slot[36..], manifest.Epoch);
    Convert.FromHexString(manifest.Lineage).CopyTo(slot[44..]);
    BinaryPrimitives.WriteUInt64LittleEndian(slot[60..], manifest.CheckpointThrough);
    BinaryPrimitives.WriteUInt64LittleEndian(slot[68..], manifest.GenerationFence);
    BinaryPrimitives.WriteUInt64LittleEndian(slot[76..], manifest.CheckpointFence);
    SHA256.HashData(slot[..ManifestSlotContentSize], slot[ManifestSlotContentSize..]);
  }

  /// <summary>How one manifest slot read back.</summary>
  private enum ManifestSlotStatus
  {
    /// <summary>Decoded, and written by this version.</summary>
    Ok,

    /// <summary>Bad magic or a checksum that does not match its content.</summary>
    Unreadable,

    /// <summary>Intact, and written by a version this build does not know.</summary>
    ForeignVersion,
  }

  private static ManifestSlotStatus TryDecodeSlot(
      ReadOnlySpan<byte> slot,
      out Manifest manifest)
  {
    manifest = Manifest.Unseeded;

    if (!slot[..ManifestMagic.Length].SequenceEqual(ManifestMagic))
    {
      return ManifestSlotStatus.Unreadable;
    }

    Span<byte> computed = stackalloc byte[ChecksumSize];
    SHA256.HashData(slot[..ManifestSlotContentSize], computed);

    // The checksum is verified BEFORE the version byte is trusted for anything.
    // Reading the version first would report a corrupted byte as "written by
    // another version" — the exact mirror of the misdiagnosis this distinction
    // exists to prevent, and it would send an operator after a deployment
    // problem during a disk fault.
    if (!computed.SequenceEqual(slot[ManifestSlotContentSize..]))
    {
      return ManifestSlotStatus.Unreadable;
    }

    if (slot[4] != ManifestVersion)
    {
      return ManifestSlotStatus.ForeignVersion;
    }

    manifest = new Manifest(
        BinaryPrimitives.ReadUInt64LittleEndian(slot[8..]),
        BinaryPrimitives.ReadUInt64LittleEndian(slot[16..]),
        BinaryPrimitives.ReadUInt64LittleEndian(slot[24..]),
        slot[5] == 1,
        BinaryPrimitives.ReadInt32LittleEndian(slot[32..]),
        BinaryPrimitives.ReadInt64LittleEndian(slot[36..]),
        Convert.ToHexStringLower(slot.Slice(44, 16)),
        BinaryPrimitives.ReadUInt64LittleEndian(slot[60..]),
        BinaryPrimitives.ReadUInt64LittleEndian(slot[68..]),
        BinaryPrimitives.ReadUInt64LittleEndian(slot[76..]));

    return ManifestSlotStatus.Ok;
  }

  /// <summary>
  /// Walks every record written since the last scan. Corruption throws: the
  /// codec consumes nothing from an invalid record, so no linear reader can find
  /// the record that follows it, and a scanner that tried to resynchronise would
  /// be silently discarding acknowledged history.
  /// </summary>
  /// <param name="confirmFenceBeforeTruncating">
  /// Null to leave a torn tail alone; otherwise a check that throws unless this
  /// session still holds the fence. Only the paths about to WRITE the journal
  /// pass one — the tail was never acknowledged, and leaving it would put the
  /// next append after a hole. A lookup passes null, because the seam says it
  /// writes nothing; it stops at the tail and the append that follows clears it.
  /// </param>
  private static List<CollabOperationRecord> ScanForward(
      FileStream journal,
      JournalIndex index,
      string documentId,
      Action? confirmFenceBeforeTruncating)
  {
    var records = new List<CollabOperationRecord>();
    var length = journal.Length;

    if (length < index.ScannedThrough)
    {
      throw new InvalidDataException(
          $"collab: the journal for \"{documentId}\" shrank from {index.ScannedThrough} " +
          $"to {length} bytes underneath this session.");
    }

    if (length == index.ScannedThrough)
    {
      return records;
    }

    var pending = new byte[length - index.ScannedThrough];
    journal.Seek(index.ScannedThrough, SeekOrigin.Begin);
    journal.ReadExactly(pending);

    var offset = 0;

    while (offset < pending.Length)
    {
      var status = CollabJournalCodec.TryDecodeRecord(
          pending.AsSpan(offset),
          out var record,
          out var consumed,
          out var error);

      if (status == CollabJournalRecordStatus.Incomplete)
      {
        if (confirmFenceBeforeTruncating is not null)
        {
          // SetLength is a BULK delete, and this offset was decided from bytes
          // read a moment ago. A holder that took the document in between may
          // have appended past it, and truncating here would cut away records
          // it has already acknowledged. Throwing costs nothing: the real
          // holder's own scan repairs the tail.
          confirmFenceBeforeTruncating();
          journal.SetLength(index.ScannedThrough + offset);
          journal.Flush(flushToDisk: true);
        }

        break;
      }

      if (status != CollabJournalRecordStatus.Ok || record is null)
      {
        throw new InvalidDataException(
            $"collab: the journal for \"{documentId}\" is corrupt at byte " +
            $"{index.ScannedThrough + offset}: {error}.");
      }

      if (record.ServerSequence != index.DurableThrough + 1)
      {
        throw new InvalidDataException(
            $"collab: the journal for \"{documentId}\" jumps from sequence " +
            $"{index.DurableThrough} to {record.ServerSequence}.");
      }

      if (!index.ById.TryAdd(record.OperationId, (record.ServerSequence, record.Digest.ToArray())))
      {
        throw new InvalidDataException(
            $"collab: the journal for \"{documentId}\" commits the operation id " +
            $"{record.OperationId} twice.");
      }

      index.DurableThrough = record.ServerSequence;
      records.Add(record);
      offset += consumed;
    }

    index.ScannedThrough += offset;
    journal.Seek(index.ScannedThrough, SeekOrigin.Begin);

    return records;
  }

  private static IReadOnlyList<ReadOnlyMemory<byte>> ReadBaseline(
      string docDirectory,
      Manifest manifest,
      string documentId)
  {
    var content = ReadSealed(
        BaselinePath(docDirectory, manifest.Generation, manifest.GenerationFence),
        BaselineMagic,
        documentId,
        out _);

    if (!CollabWorkingSetCodec.TryDecodeFrames(content, out var frames))
    {
      throw new InvalidDataException(
          $"collab: the baseline for \"{documentId}\" is not a valid frame section.");
    }

    return [.. frames.Select(frame => new ReadOnlyMemory<byte>(frame))];
  }

  private static CollabOperationCheckpoint ReadCheckpoint(
      string docDirectory,
      Manifest manifest,
      string documentId)
  {
    var state = ReadSealed(
        CheckpointPath(
            docDirectory,
            manifest.Generation,
            manifest.CheckpointThrough,
            manifest.CheckpointFence),
        CheckpointMagic,
        documentId,
        out var through);

    if (through != manifest.CheckpointThrough)
    {
      throw new InvalidDataException(
          $"collab: the checkpoint file for \"{documentId}\" carries sequence {through}, " +
          $"but the manifest names {manifest.CheckpointThrough}.");
    }

    return new CollabOperationCheckpoint(through, state);
  }

  private static void WriteSealed(
      string path,
      ReadOnlySpan<byte> magic,
      ulong tag,
      ReadOnlySpan<byte> content)
  {
    var buffer = new byte[SealedHeaderSize + content.Length + ChecksumSize];
    var span = buffer.AsSpan();
    magic.CopyTo(span);
    span[4] = SealedVersion;
    BinaryPrimitives.WriteUInt64LittleEndian(span[8..], tag);
    BinaryPrimitives.WriteInt64LittleEndian(span[16..], content.Length);
    content.CopyTo(span[SealedHeaderSize..]);
    SHA256.HashData(
        span[..(SealedHeaderSize + content.Length)],
        span.Slice(SealedHeaderSize + content.Length, ChecksumSize));

    using var file = new FileStream(
        path,
        CreateOptions(FileAccess.Write, FileMode.Create, FileShare.None));
    file.Write(buffer);
    file.Flush(flushToDisk: true);
  }

  private static byte[] ReadSealed(
      string path,
      ReadOnlySpan<byte> magic,
      string documentId,
      out ulong tag)
  {
    byte[] bytes;

    try
    {
      bytes = File.ReadAllBytes(path);
    }
    catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
    {
      throw new InvalidDataException(
          $"collab: \"{documentId}\" names {Path.GetFileName(path)}, which is not there.",
          error);
    }

    if (bytes.Length < SealedHeaderSize + ChecksumSize ||
        !bytes.AsSpan(0, magic.Length).SequenceEqual(magic) ||
        bytes[4] != SealedVersion)
    {
      throw new InvalidDataException(
          $"collab: {Path.GetFileName(path)} for \"{documentId}\" is not a readable record.");
    }

    tag = BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(8));
    var contentLength = BinaryPrimitives.ReadInt64LittleEndian(bytes.AsSpan(16));

    if (contentLength < 0 ||
        contentLength != bytes.Length - SealedHeaderSize - ChecksumSize)
    {
      throw new InvalidDataException(
          $"collab: {Path.GetFileName(path)} for \"{documentId}\" declares {contentLength} " +
          "content bytes, which is not what it holds.");
    }

    var hashed = SealedHeaderSize + (int)contentLength;
    Span<byte> computed = stackalloc byte[ChecksumSize];
    SHA256.HashData(bytes.AsSpan(0, hashed), computed);

    if (!computed.SequenceEqual(bytes.AsSpan(hashed, ChecksumSize)))
    {
      throw new InvalidDataException(
          $"collab: {Path.GetFileName(path)} for \"{documentId}\" fails its checksum.");
    }

    return bytes[SealedHeaderSize..hashed];
  }

  // DllImport, not LibraryImport: the source generator emits unsafe code and
  // AllowUnsafeBlocks is off for the whole project.
#pragma warning disable SYSLIB1054
  // The path is marshalled by hand as NUL-terminated UTF-8 so no string
  // marshalling has to be declared.
  [DllImport("libc", EntryPoint = "open", ExactSpelling = true, SetLastError = true)]
  private static extern int Open(byte[] path, int flags);

  [DllImport("libc", EntryPoint = "fsync", ExactSpelling = true, SetLastError = true)]
  private static extern int Fsync(int descriptor);

  [DllImport("libc", EntryPoint = "close", ExactSpelling = true, SetLastError = true)]
  private static extern int Close(int descriptor);
#pragma warning restore SYSLIB1054

  /// <summary>
  /// A newly created entry is only durable once the DIRECTORY holding it is on
  /// disk. This runs at an acknowledgement boundary — seeding, a reset, a
  /// checkpoint publication — so a failure is THROWN rather than logged: an
  /// ignored error here is exactly an acknowledgement of something that is not
  /// durable. Windows exposes no directory sync at all; there the entry's
  /// durability rests on NTFS's metadata log being flushed by the file-handle
  /// flush the caller has already done, which this code cannot verify.
  /// </summary>
  private static void SyncDirectory(string path)
  {
    if (OperatingSystem.IsWindows())
    {
      return;
    }

    var descriptor = Open(Encoding.UTF8.GetBytes(path + "\0"), ReadOnlyFlags);

    if (descriptor < 0)
    {
      throw new IOException(
          $"collab: could not open \"{path}\" to flush it " +
          $"(errno {Marshal.GetLastPInvokeError()}).");
    }

    try
    {
      if (Fsync(descriptor) != 0)
      {
        throw new IOException(
            $"collab: could not flush the directory \"{path}\" " +
            $"(errno {Marshal.GetLastPInvokeError()}).");
      }
    }
    finally
    {
      _ = Close(descriptor);
    }
  }

  /// <summary>
  /// Re-read from the PATH, never from a handle the caller opened: a manifest
  /// that was replaced or removed leaves that handle pointing at an inode
  /// nobody else writes any more.
  /// </summary>
  private static void RequireFence(
      string docDirectory,
      string documentId,
      Manifest held)
  {
    var onDisk = ReadManifest(Path.Combine(docDirectory, ManifestName), documentId);

    if (onDisk is null ||
        onDisk.Value.Fence != held.Fence ||
        onDisk.Value.Generation != held.Generation)
    {
      throw new CollabOperationFenceLostException();
    }
  }

  /// <summary>The manifest's published state; the fence lives here.</summary>
  /// <param name="GenerationFence">
  /// The fence held by the session that minted the current generation's
  /// baseline and journal. It is part of their file NAMES, which is what stops
  /// two holders from ever computing the same one — see the type's remarks.
  /// </param>
  /// <param name="CheckpointFence">
  /// The fence held by the session that wrote the published checkpoint, for the
  /// same reason.
  /// </param>
  private readonly record struct Manifest(
      ulong WriteCounter,
      ulong Fence,
      ulong Generation,
      bool Seeded,
      int Format,
      long Epoch,
      string Lineage,
      ulong CheckpointThrough,
      ulong GenerationFence,
      ulong CheckpointFence)
  {
    internal static Manifest Unseeded { get; } =
        new(0, 0, 0, false, 0, 0, new string('0', CollabWorkingSetTag.LineageLength), 0, 0, 0);
  }

  private sealed class JournalIndex
  {
    internal Dictionary<string, (ulong Sequence, byte[] Digest)> ById { get; } =
        new(StringComparer.Ordinal);

    internal ulong DurableThrough { get; set; }

    /// <summary>Byte offset every record before which is already indexed.</summary>
    internal long ScannedThrough { get; set; }

    internal void Clear()
    {
      ById.Clear();
      DurableThrough = 0;
      ScannedThrough = 0;
    }
  }

  private sealed class Session : ICollabOperationSession
  {
    private readonly LocalCollabOperationStore store;
    private readonly string documentId;
    private readonly string docDirectory;
    private readonly FileStream hold;
    private readonly FileStream manifestFile;
    private readonly JournalIndex index;

    private FileStream? journal;
    private Manifest manifest;
    private bool disposed;
    private bool faulted;

    internal Session(
        LocalCollabOperationStore store,
        string documentId,
        string docDirectory,
        FileStream hold,
        FileStream manifestFile,
        FileStream? journal,
        Manifest manifest,
        JournalIndex index,
        CollabOperationOpenResult openResult)
    {
      this.store = store;
      this.documentId = documentId;
      this.docDirectory = docDirectory;
      this.hold = hold;
      this.manifestFile = manifestFile;
      this.journal = journal;
      this.manifest = manifest;
      this.index = index;
      OpenResult = openResult;
    }

    public CollabOperationOpenResult OpenResult { get; }

    public ValueTask<CollabOperationLookup> FindCommittedAsync(
        string operationId,
        ReadOnlyMemory<byte> digest,
        CancellationToken cancellationToken = default)
    {
      ArgumentException.ThrowIfNullOrEmpty(operationId);
      cancellationToken.ThrowIfCancellationRequested();

      RequireFence();
      Refresh(repair: false);

      return ValueTask.FromResult(index.ById.TryGetValue(operationId, out var existing)
        ? new CollabOperationLookup(
            digest.Span.SequenceEqual(existing.Digest)
              ? CollabOperationLookupOutcome.Duplicate
              : CollabOperationLookupOutcome.Conflict,
            existing.Sequence)
        : new CollabOperationLookup(CollabOperationLookupOutcome.NotCommitted, 0));
    }

    public ValueTask<CollabOperationAppendResult> AppendAsync(
        CollabOperationCandidate candidate,
        CancellationToken cancellationToken = default)
    {
      ArgumentNullException.ThrowIfNull(candidate);

      // Checked once, at entry. The write and its flush are deliberately
      // uncancellable: a token honoured mid-append would surface to the caller
      // as its own shutdown and leave an outcome nobody goes back to resolve.
      cancellationToken.ThrowIfCancellationRequested();

      RequireFence();
      Refresh(repair: true);

      if (index.ById.TryGetValue(candidate.OperationId, out var existing))
      {
        return ValueTask.FromResult(new CollabOperationAppendResult(
            candidate.Digest.Span.SequenceEqual(existing.Digest)
              ? CollabOperationAppendOutcome.Duplicate
              : CollabOperationAppendOutcome.Conflict,
            existing.Sequence));
      }

      if (!manifest.Seeded || journal is null)
      {
        throw new InvalidOperationException(
            $"collab: \"{documentId}\" was never seeded; reset it first.");
      }

      // The codec's own ceiling only stops an absurd allocation; the server's
      // configured wire limit is the policy.
      if (candidate.Update.Length > store.maxUpdateBytes)
      {
        throw new ArgumentOutOfRangeException(
            nameof(candidate),
            candidate.Update.Length,
            $"collab: the update exceeds the configured {store.maxUpdateBytes}-byte limit.");
      }

      var sequence = index.DurableThrough + 1;
      var bytes = CollabJournalCodec.EncodeRecord(new CollabOperationRecord(
          candidate.OperationId,
          sequence,
          DateTimeOffset.UtcNow,
          candidate.ActorId,
          candidate.Source,
          candidate.Update,
          candidate.Digest));

      var lengthBefore = journal.Length;

      try
      {
        journal.Seek(0, SeekOrigin.End);
        journal.Write(bytes);
        journal.Flush(flushToDisk: true);
      }
      catch (IOException)
      {
        // The record is in the page cache but not on disk, and Linux marks the
        // dirty pages clean after a failed fsync, so no later flush retries
        // them. Left in place, the retry the caller is contracted to make would
        // read it back through that same cache and be told Duplicate — an
        // acknowledgement of something no disk holds. Put the file back to
        // "not committed" instead; nothing was acknowledged, so nothing is lost.
        RollBack(lengthBefore);

        throw;
      }

      // Re-read after the flush, because the fence check above and this write
      // are not one atomic step: a holder judged dead in between could have
      // taken the document, and the caller must not be told "saved" for a
      // sequence somebody else may already have reassigned.
      RequireFence();

      index.ById[candidate.OperationId] = (sequence, candidate.Digest.ToArray());
      index.DurableThrough = sequence;
      index.ScannedThrough = journal.Position;

      return ValueTask.FromResult(
          new CollabOperationAppendResult(CollabOperationAppendOutcome.Committed, sequence));
    }

    public ValueTask WriteCheckpointAsync(
        CollabOperationCheckpoint checkpoint,
        CancellationToken cancellationToken = default)
    {
      ArgumentNullException.ThrowIfNull(checkpoint);
      cancellationToken.ThrowIfCancellationRequested();

      RequireFence();
      Refresh(repair: false);

      if (checkpoint.Through == 0 ||
          checkpoint.Through > index.DurableThrough ||
          checkpoint.Through < manifest.CheckpointThrough)
      {
        throw new ArgumentOutOfRangeException(
            nameof(checkpoint),
            checkpoint.Through,
            "a checkpoint must name a committed sequence at or above the published one");
      }

      // Republishing the sequence already published is an accepted no-op: it is
      // the natural retry after an unknown outcome.
      if (checkpoint.Through == manifest.CheckpointThrough)
      {
        return ValueTask.CompletedTask;
      }

      // The writing session's fence is in the NAME, so a session that stalls
      // here and is judged dead cannot overwrite the checkpoint bytes the new
      // holder published in the meantime — it writes a name nobody references
      // and its Republish then throws on the fence.
      var path = CheckpointPath(
          docDirectory,
          manifest.Generation,
          checkpoint.Through,
          manifest.Fence);
      WriteSealed(path, CheckpointMagic, checkpoint.Through, checkpoint.State.Span);
      SyncDirectory(docDirectory);
      Republish(manifest with
      {
        CheckpointThrough = checkpoint.Through,
        CheckpointFence = manifest.Fence,
      });

      // Only after the publication that made the new checkpoint current: an
      // earlier sweep would delete the state the manifest still names. And only
      // names ending in THIS session's fence: the glob covers every fence, so
      // an unscoped sweep is a delete of another holder's live checkpoint, with
      // no fence check in front of it.
      //
      // The cost is a LEAK, and nothing collects it: another session's
      // checkpoints stay on disk for the life of the document, one
      // full-document-state file per session per generation, accumulating
      // across every restart and failover. A "delete anything the manifest does
      // not name" collector would be wrong — it races a live holder between its
      // WriteSealed and its publication — so a real one needs the fence, and
      // there is no such collector.
      var mine = string.Create(CultureInfo.InvariantCulture, $".{manifest.Fence}");

      foreach (var stale in Directory.GetFiles(
          docDirectory,
          string.Create(CultureInfo.InvariantCulture, $"checkpoint.{manifest.Generation}.*")))
      {
        if (!string.Equals(stale, path, StringComparison.Ordinal) &&
            stale.EndsWith(mine, StringComparison.Ordinal))
        {
          TryDelete(stale);
        }
      }

      return ValueTask.CompletedTask;
    }

    public ValueTask<CollabDocumentHead> ResetAsync(
        CollabOperationReset reset,
        CancellationToken cancellationToken = default)
    {
      ArgumentNullException.ThrowIfNull(reset);
      ArgumentNullException.ThrowIfNull(reset.Baseline);
      cancellationToken.ThrowIfCancellationRequested();

      RequireFence();

      if (!CollabWorkingSetTag.IsLineage(reset.Lineage))
      {
        throw new ArgumentException(
            $"collab: the lineage {reset.Lineage} is not 32 lowercase-hex characters.",
            nameof(reset));
      }

      if (reset.Format < 1)
      {
        throw new ArgumentException(
            $"collab: the format {reset.Format} is not a schema version.",
            nameof(reset));
      }

      if (manifest.Seeded && reset.Epoch <= manifest.Epoch)
      {
        throw new ArgumentOutOfRangeException(
            nameof(reset),
            reset.Epoch,
            $"a reset must raise the epoch above {manifest.Epoch}");
      }

      var generation = manifest.Generation + 1;

      // THE MINTING FENCE IS PART OF EVERY NAME THIS RESET WRITES, and that is
      // the whole safety property here, not the checks around it. The generation
      // alone is a name a NEW holder computes identically: a session that
      // stalls after its entry fence check — a GC pause, or the stall that got
      // it judged dead — would resume and overwrite the baseline the new holder
      // had published and truncate the journal it had already acknowledged
      // operations into. No check-then-act guard closes that, because the stall
      // can happen after the check. Two holders never share a fence, so with
      // the fence in the name they never share a file: a stale reset writes
      // names nothing references, Republish throws, and what it left behind is
      // collectable exactly like a crashed reset's orphans.
      var mintedBy = manifest.Fence;

      using (var frames = new MemoryStream())
      {
        foreach (var frame in reset.Baseline)
        {
          if (frame.Length == 0)
          {
            throw new ArgumentException(
                "collab: baseline frames must not be empty.",
                nameof(reset));
          }

          CollabWorkingSetCodec.AppendFrame(frames, frame.Span);
        }

        WriteSealed(
            BaselinePath(docDirectory, generation, mintedBy),
            BaselineMagic,
            0,
            frames.GetBuffer().AsSpan(0, (int)frames.Length));
      }

      // Opened BEFORE the publication, and swapped in only once everything
      // that can throw has run: a failure between the publication and the swap
      // would leave the session on the old lineage's index, and because the
      // duplicate check precedes the seeded check, it would then answer
      // Duplicate for ids belonging to a lineage that can never be replayed.
      var swapped = OpenJournal(
          JournalPath(docDirectory, generation, mintedBy),
          FileMode.OpenOrCreate);

      try
      {
        // Only ever this session's own abandoned earlier attempt at the same
        // fence and generation, because the name carries both. The fence check
        // is defence in depth, not the property being relied on.
        RequireFence();
        swapped.SetLength(0);
        swapped.Flush(flushToDisk: true);

        // Both new files are durable, and so are their directory entries,
        // before the manifest names them. The publication is the whole of the
        // switch: until it lands, the old generation is still the document.
        SyncDirectory(docDirectory);
        Republish(manifest with
        {
          Generation = generation,
          GenerationFence = mintedBy,
          CheckpointFence = 0,
          Seeded = true,
          Format = reset.Format,
          Epoch = reset.Epoch,
          Lineage = reset.Lineage,
          CheckpointThrough = 0,
        });
      }
      catch
      {
        swapped.Dispose();

        throw;
      }

      journal?.Dispose();
      journal = swapped;
      index.Clear();

      return ValueTask.FromResult(
          new CollabDocumentHead(reset.Format, reset.Epoch, reset.Lineage, DurableThrough: 0));
    }

    public ValueTask DisposeAsync()
    {
      if (!disposed)
      {
        disposed = true;

        // Only this session's own handles close. The lock FILE is never
        // removed: a session that has lost the fence would otherwise delete the
        // hold that now belongs to somebody else.
        journal?.Dispose();
        manifestFile.Dispose();
        hold.Dispose();
      }

      return ValueTask.CompletedTask;
    }

    /// <summary>
    /// Undoes an append whose write or flush failed, so the retry the caller is
    /// contracted to make cannot read the record back out of the page cache and
    /// be told Duplicate.
    /// </summary>
    /// <remarks>
    /// <para>
    /// THE FENCE IS CHECKED AGAIN HERE, immediately before the truncate, and
    /// this is not defence in depth — it is the difference between undoing this
    /// session's own failed write and deleting somebody else's committed
    /// history. <c>length</c> was read before the write; if the fence moved in
    /// between, the new holder may have committed and acknowledged records at
    /// and after that offset, and <see cref="FileStream.SetLength"/> is a bulk
    /// delete that takes all of them. Comparing lengths would not help — this
    /// session's record can be exactly as long as the one that replaced it.
    /// </para>
    /// <para>
    /// When the fence is gone, or the roll-back itself cannot be flushed, this
    /// session can no longer say what disk holds, so it stops answering at all:
    /// every later call throws and the caller reopens from committed data.
    /// Leaving the bytes alone is not free, and the trade is deliberate: a
    /// TORN tail the real holder repairs on its own scan, but a COMPLETE,
    /// checksum-valid record whose sequence duplicates one the new holder
    /// assigned makes every later open fail closed on the contiguity check,
    /// with no resynchronisation path and no operator tool. Intact bytes and a
    /// loud failure still beat silently deleting a record somebody was told was
    /// saved.
    /// </para>
    /// </remarks>
    private void RollBack(long length)
    {
      try
      {
        RequireFence();
        journal!.SetLength(length);
        journal.Flush(flushToDisk: true);
      }
      catch (Exception error)
          when (error is IOException or
              CollabOperationFenceLostException or
              InvalidDataException or
              UnauthorizedAccessException)
      {
        // UnauthorizedAccessException included because RequireFence reads the
        // manifest: escaping here would replace the failure the caller is being
        // told about AND leave the record in the journal with faulted unset.
        faulted = true;
      }
    }

    /// <summary>
    /// The fence is re-verified immediately before the slot write, not just at
    /// the start of the operation: a checkpoint or reset writes its files
    /// first, and over a large state that gap is long enough for a holder
    /// judged dead to take the document — after which this publication would
    /// overwrite the new holder's fence with this session's older one.
    /// </summary>
    private void Republish(Manifest next)
    {
      RequireFence();

      var published = next with { WriteCounter = manifest.WriteCounter + 1 };
      Publish(manifestFile, published);
      manifest = published;
    }

    private void RequireFence()
    {
      ObjectDisposedException.ThrowIf(disposed, this);

      if (faulted)
      {
        // Not OperationCanceledException: the caller reads a cancellation it
        // did not ask for as its own shutdown.
        throw new IOException(
            $"collab: the journal for \"{documentId}\" could not be flushed and this " +
            "session can no longer say what is durable; reopen the document.");
      }

      LocalCollabOperationStore.RequireFence(docDirectory, documentId, manifest);
    }

    /// <summary>
    /// Reads the durable bytes, never a memo of what this session appended. The
    /// two differ in exactly the case that matters: an append that threw may
    /// still have committed, so the retry after an unknown outcome is the one
    /// lookup that must not be answered from memory.
    /// </summary>
    private void Refresh(bool repair)
    {
      if (journal is not null)
      {
        _ = ScanForward(
            journal,
            index,
            documentId,
            repair ? RequireFence : null);
      }
    }

    private void TryDelete(string path)
    {
      try
      {
        File.Delete(path);
      }
      catch (Exception error) when (error is IOException or UnauthorizedAccessException)
      {
        store.log?.Invoke(
            $"collab: could not remove the superseded {Path.GetFileName(path)} for " +
            $"\"{documentId}\": {error.Message}");
      }
    }
  }
}
