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
  /// True for connections that negotiated blok-sync.v1: the room sends them
  /// the epoch control frame as their first frame (plan decision 6). The
  /// endpoint must not send it as well.
  /// </summary>
  bool AcceptsControlFrames { get; }

  /// <summary>
  /// Actor to attribute this member's writes to, once something journals
  /// them (Task 3.2 onward — nothing reads this yet). Derived at the
  /// handshake from the ticket's user claim or the signed-in principal —
  /// never from a rate-limit/connection-cap key, and never from anything the
  /// client sends after the handshake. Null when the connection carries no
  /// verified identity: an unknown author stays unknown rather than getting
  /// a fabricated name in durable history.
  /// </summary>
  string? ActorId { get; }

  /// <summary>
  /// Protocol this member negotiated, for the operation source a future
  /// commit path (Task 3.2 onward) would record for its writes.
  /// </summary>
  CollabOperationSource ProtocolSource { get; }

  /// <summary>One fully encoded wire frame (see <see cref="SyncWire"/>).</summary>
  void Send(byte[] frame);

  void Close(CollabCloseReason reason);
}
