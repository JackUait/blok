namespace Blok.Server.Mcp;

/// <summary>
/// The host's own uploader, which an agent's upload goes through (blok-mcp's <c>uploads</c>
/// option). It turns on <c>image.uploadFile</c>, <c>video.uploadFile</c>, <c>audio.uploadFile</c>
/// and <c>file.uploadFile</c>. The agent sends the bytes as base64; Node's <c>root</c> folder is
/// stdio only, so it is not here.
/// </summary>
public sealed class BlokMcpUploads
{
  /// <summary>The host's uploader.</summary>
  public required BlokMcpUploader Uploader { get; init; }

  /// <summary>
  /// Per kind (<c>image</c>, <c>video</c>, <c>audio</c>, <c>file</c>), like a media tool's types
  /// and max size. Defaults: image/*, audio/* and video/* only; 30 MiB, video 100 MiB.
  /// </summary>
  public IDictionary<string, BlokMcpUploadLimits>? Limits { get; init; }
}

/// <summary>The host's uploader: <c>uploadByFile</c>, and <c>uploadByUrl</c> when it copies linked files.</summary>
public sealed class BlokMcpUploader
{
  /// <summary>
  /// Stores one file. A file card keeps the size and type it returns. A throw is logged in full;
  /// the agent sees "The upload failed.", or the message of a <see cref="BlokMcpUploadException"/>.
  /// </summary>
  public required Func<BlokMcpUploadFile, BlokMcpUploadContext, CancellationToken, ValueTask<BlokMcpUploadedFile>> UploadByFile { get; init; }

  /// <summary>When set, <c>&lt;tool&gt;.setSource</c> copies a linked file to the host too.</summary>
  public Func<Uri, BlokMcpUploadContext, CancellationToken, ValueTask<BlokMcpUploadedFile>>? UploadByUrl { get; init; }
}

/// <summary>What kind of asset an upload is for, and which tool asked.</summary>
/// <param name="Kind"><c>image</c>, <c>video</c>, <c>audio</c> or <c>file</c>.</param>
/// <param name="Tool">The block tool that uploads.</param>
public sealed record BlokMcpUploadContext(string Kind, string Tool);

/// <summary>One file an agent uploads, already checked against the limits (a browser File).</summary>
/// <param name="Bytes">The file's bytes.</param>
/// <param name="Name">The cleaned file name.</param>
/// <param name="Type">The type its extension gives, or empty when unknown.</param>
public sealed record BlokMcpUploadFile(ReadOnlyMemory<byte> Bytes, string Name, string Type);

/// <summary>Where the host stored a file.</summary>
/// <param name="Url">The stored file's URL.</param>
public sealed record BlokMcpUploadedFile(Uri Url)
{
  /// <summary>The name the host gave it; absent keeps the uploaded name.</summary>
  public string? FileName { get; init; }

  /// <summary>The stored size in bytes, which a file card keeps.</summary>
  public long? Size { get; init; }

  /// <summary>The stored type, which a file card keeps.</summary>
  public string? MimeType { get; init; }
}

/// <summary>One asset kind's limits.</summary>
public sealed class BlokMcpUploadLimits
{
  /// <summary>MIME types it takes, such as <c>image/*</c>; absent keeps the tool's default.</summary>
  public IList<string>? Types { get; init; }

  /// <summary>The largest file in bytes; absent keeps the tool's default.</summary>
  public long? MaxSize { get; init; }
}

/// <summary>
/// Thrown by the host's uploader to show the agent a message. Any other exception reaches the
/// agent only as "The upload failed.", since its text can name the host's internals; the full
/// exception is always logged. The agent's command fails with TOOL_ACTION_FAILED, not retryable.
/// </summary>
public sealed class BlokMcpUploadException : Exception
{
  /// <summary>Creates the exception.</summary>
  /// <param name="agentMessage">What the agent sees. Write it for the agent: no paths, hosts or secrets.</param>
  /// <param name="innerException">The cause, for the server log only.</param>
  public BlokMcpUploadException(string agentMessage, Exception? innerException = null)
      : base(agentMessage, innerException)
  {
    ArgumentNullException.ThrowIfNull(agentMessage);
    AgentMessage = agentMessage;
  }

  /// <summary>What the agent sees.</summary>
  public string AgentMessage { get; }
}
