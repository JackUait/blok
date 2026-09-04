namespace Blok.Server.Collab;

/// <summary>Why the room is closing a member's connection; the endpoint maps it to a close code.</summary>
internal enum CollabCloseReason
{
  /// <summary>The doc was reset (epoch bumped); close 4409 and let the client resync.</summary>
  Reset,

  /// <summary>The server is shutting down; close 1001.</summary>
  Draining,

  /// <summary>
  /// The member kept sending awareness frames a stock client cannot parse;
  /// close 1008, after which the client reconnects with its usual backoff.
  /// </summary>
  BadAwareness,

  /// <summary>
  /// Close 4503: the room could not confirm an edit was journalled, so it
  /// discarded itself. Its text differs from <c>SeedFailed</c>'s "document
  /// unavailable" on the same status, and it is not <c>Reset</c>'s 4409: that
  /// status tells the client to relineage and discard pending work, which a
  /// retryable commit failure must not trigger.
  /// </summary>
  CommitUnavailable,

  /// <summary>
  /// Close 1008: a member that negotiated v2 sent a raw SyncStep2 or
  /// SyncUpdate. Such a frame carries no operation id, so it can be answered
  /// with neither an acknowledgement nor a rejection. Not <c>BadAwareness</c>,
  /// the other 1008: that one is a relay the room tolerates twice before
  /// closing, this one is refused on the first frame and applies nothing.
  /// </summary>
  RawWriteOnV2,
}

/// <summary>
/// One connection in a room, as the sync endpoint presents it. The room calls
/// every member INSIDE its lane, so both methods must enqueue and return —
/// never block on the socket, never throw.
/// </summary>
internal interface ICollabMember
{
  /// <summary>False drops the member's SyncStep2 and Update frames (plan decision 10).</summary>
  bool CanWrite { get; }

  /// <summary>
  /// True for connections that negotiated a blok-sync subprotocol (v1 or v2):
  /// the room sends them the epoch control frame as their first frame (plan
  /// decision 6). The endpoint must not send it as well.
  /// </summary>
  bool AcceptsControlFrames { get; }

  /// <summary>
  /// Actor a journalled write is attributed to. Recorded on every committed
  /// operation, a v1 one included. Derived at the handshake from the ticket's
  /// user claim or the signed-in principal —
  /// never from a rate-limit/connection-cap key, and never from anything the
  /// client sends after the handshake. Null when the connection carries no
  /// verified identity: an unknown author stays unknown rather than getting
  /// a fabricated name in durable history.
  /// </summary>
  string? ActorId { get; }

  /// <summary>
  /// Protocol this member negotiated; it becomes the source recorded on the
  /// operations the room commits for it.
  /// </summary>
  CollabOperationSource ProtocolSource { get; }

  /// <summary>One fully encoded wire frame (see <see cref="SyncWire"/>).</summary>
  void Send(byte[] frame);

  void Close(CollabCloseReason reason);
}
