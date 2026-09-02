namespace Blok.Server.Yjs;

/// <summary>
/// One transaction's worth of changes, encoded as a v1 update.
/// <paramref name="Local"/> is false for changes an applied remote update
/// caused, which is what tells the room not to echo them back.
/// </summary>
internal readonly record struct YUpdateEvent(byte[] Update, bool Local);
