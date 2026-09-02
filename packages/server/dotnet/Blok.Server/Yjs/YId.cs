namespace Blok.Server.Yjs;

/// <summary>
/// A struct's identity: the client that created it and that client's clock at
/// creation. Both are lib0 varuints, so both are 53-bit safe rather than 32-bit.
/// </summary>
internal readonly record struct YId(ulong Client, ulong Clock);
