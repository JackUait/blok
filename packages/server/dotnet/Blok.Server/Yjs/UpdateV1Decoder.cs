namespace Blok.Server.Yjs;

/// <summary>
/// Yjs's v1 update format, read whole and refused on anything unexpected:
/// client groups of structs, then a delete set, then nothing.
///
/// It is stricter than yjs in three places, each because leniency there hides
/// corruption rather than tolerating it: trailing bytes after the delete set
/// are an error (a v1 reader never looks, which is why it silently swallows a
/// v2 update), a client listed twice is an error (yjs's Map.set keeps the
/// last group and drops the first), and a length past int.MaxValue is an
/// error rather than an overflowing cast.
///
/// There is deliberately no v2 sniff: <c>00 00</c> is the legitimate empty v1
/// update the room sends on every sync, and a v2 payload is simply one that
/// fails to parse as v1.
/// </summary>
internal static class UpdateV1Decoder
{
  private const byte OriginBit = 0x80;

  private const byte RightOriginBit = 0x40;

  private const byte ParentSubBit = 0x20;

  private const byte StructKindMask = 0x1F;

  private const byte GcKind = 0;

  private const byte SkipKind = 10;

  public static DecodedUpdate Decode(ReadOnlySpan<byte> update)
  {
    var reader = new Lib0Reader(update);
    var structs = new Dictionary<ulong, IReadOnlyList<DecodedStruct>>();
    var groups = reader.ReadVarUint();

    for (ulong group = 0; group < groups; group++)
    {
      // The count is not preallocated: a hostile one would allocate gigabytes
      // before the truncated buffer ever complained.
      var count = reader.ReadVarUint();
      var client = reader.ReadVarUint();
      var clock = reader.ReadVarUint();

      if (structs.ContainsKey(client))
      {
        throw new Lib0FormatException(
            $"yjs: client {client} is listed twice; a v1 update lists each client once.");
      }

      var decoded = new List<DecodedStruct>();

      for (ulong index = 0; index < count; index++)
      {
        var read = ReadStruct(ref reader, client, clock);

        decoded.Add(read);
        clock += (ulong)read.Length;
      }

      structs.Add(client, decoded);
    }

    var deleteSet = DeleteSet.Read(ref reader);

    if (!reader.AtEnd)
    {
      throw new Lib0FormatException(
          $"yjs: {reader.Length - reader.Position} bytes follow the delete set.");
    }

    return new DecodedUpdate(structs, deleteSet);
  }

  private static DecodedStruct ReadStruct(ref Lib0Reader reader, ulong client, ulong clock)
  {
    var info = reader.ReadUint8();
    var id = new YId(client, clock);

    switch (info & StructKindMask)
    {
      case GcKind:
        return Placeholder(
            id, YContent.ReadLength(ref reader, "GC length"), DecodedStructKind.Gc, info);

      case SkipKind:
        // A Skip's length is a raw varuint, never the length encoding: it
        // stands for a gap, whose size no run-length scheme can predict.
        return Placeholder(
            id, YContent.ReadLength(ref reader, "Skip length"), DecodedStructKind.Skip, info);

      default:
        return ReadItem(ref reader, id, info);
    }
  }

  private static DecodedStruct ReadItem(ref Lib0Reader reader, YId id, byte info)
  {
    var origin = (info & OriginBit) != 0 ? ReadId(ref reader) : (YId?)null;
    var rightOrigin = (info & RightOriginBit) != 0 ? ReadId(ref reader) : (YId?)null;
    string? parentRoot = null;
    YId? parentId = null;
    string? parentSub = null;

    // The parent and the parentSub are on the wire only when neither origin
    // is: with a neighbour to inherit from, yjs copies them at integration.
    if (origin is null && rightOrigin is null)
    {
      var parentInfo = reader.ReadVarUint();

      switch (parentInfo)
      {
        case 1:
          parentRoot = reader.ReadVarString();
          break;

        case 0:
          parentId = ReadId(ref reader);
          break;

        default:
          throw new Lib0FormatException(
              $"yjs: the parent info at {reader.Position} is {parentInfo}; " +
              "a v1 update writes 1 for a root name and 0 for a parent id.");
      }

      if ((info & ParentSubBit) != 0)
      {
        parentSub = reader.ReadVarString();
      }
    }

    var content = YContent.Read(info, ref reader);

    return new DecodedStruct(
        id,
        content.Length,
        DecodedStructKind.Item,
        origin,
        rightOrigin,
        parentRoot,
        parentId,
        parentSub,
        content,
        info);
  }

  private static DecodedStruct Placeholder(
      YId id, int length, DecodedStructKind kind, byte info)
  {
    return new DecodedStruct(id, length, kind, null, null, null, null, null, null, info);
  }

  private static YId ReadId(ref Lib0Reader reader)
  {
    var client = reader.ReadVarUint();

    return new YId(client, reader.ReadVarUint());
  }
}
