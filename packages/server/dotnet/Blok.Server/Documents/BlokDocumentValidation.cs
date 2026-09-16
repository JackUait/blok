using System.Text.Json.Serialization;

namespace Blok.Server.Documents;

/// <summary>
/// What <see cref="IBlokDocumentConverter.ValidateAsync"/> found: whether the
/// input is a document at all, whether it holds any text, and which of its
/// blocks Blok could make nothing of.
/// </summary>
/// <remarks>
/// Every field is a statement about the input, never an error to handle — the
/// call that produced this did not throw and never will for bad input. Read
/// <see cref="IsDocument"/> first: when it is <c>false</c> nothing else was
/// measured, and <see cref="Failure"/> says why.
/// <para>
/// The three questions it separates, which an empty conversion result cannot:
/// an empty document (<see cref="IsEmpty"/> with <see cref="BlockCount"/> zero),
/// a document of blocks that carry no text by design — dividers, spacers,
/// callouts (<see cref="IsEmpty"/> with blocks and no unrecognized types), and a
/// document Blok did not understand (<see cref="UnrecognizedBlockTypes"/> or
/// <see cref="MalformedBlockCount"/> above zero).
/// </para>
/// </remarks>
public sealed record BlokDocumentValidation
{
  /// <summary>
  /// The input parsed as a JSON object carrying a <c>blocks</c> array. When
  /// this is <c>false</c> every other member is at its zero value and
  /// <see cref="Failure"/> is set.
  /// </summary>
  [JsonIgnore]
  public bool IsDocument { get; init; }

  /// <summary>
  /// The document yields no readable text — what
  /// <see cref="IBlokDocumentConverter.ToPlainTextAsync"/> would return as an
  /// empty string, with its default options.
  /// </summary>
  /// <remarks>
  /// Empty is not the same as contentless. A document holding only an image
  /// with no caption, or only dividers, is empty by this measure and still has
  /// blocks — read <see cref="BlockCount"/> alongside it.
  /// </remarks>
  [JsonPropertyName("isEmpty")]
  public bool IsEmpty { get; init; }

  /// <summary>How many blocks were readable, malformed ones excluded.</summary>
  [JsonPropertyName("blockCount")]
  public int BlockCount { get; init; }

  /// <summary>
  /// How many entries of the <c>blocks</c> array were too malformed to read —
  /// not an object, or with no <c>type</c> string. Every conversion skips these
  /// rather than failing, so one bad entry never costs a whole article; this is
  /// how a caller finds out it happened.
  /// </summary>
  [JsonPropertyName("malformedBlockCount")]
  public int MalformedBlockCount { get; init; }

  /// <summary>
  /// Distinct block types this build of Blok has no reader for, in document
  /// order. A custom tool a host registered in the browser lands here: the
  /// document is fine, this package just cannot read its text.
  /// </summary>
  [JsonPropertyName("unrecognizedBlockTypes")]
  public IReadOnlyList<string> UnrecognizedBlockTypes { get; init; } = [];

  /// <summary>
  /// Why the input could not be inspected, or <c>null</c> when it was.
  /// <see cref="BlokConversionFailure.InvalidDocument"/> for input that is not a
  /// document; the timeout and budget values only when the runtime itself ran
  /// out while looking.
  /// </summary>
  [JsonIgnore]
  public BlokConversionFailure? Failure { get; init; }

  /// <summary>
  /// The document is one Blok read completely: a document, with nothing
  /// malformed and no unrecognized block type. It may still be empty.
  /// </summary>
  [JsonIgnore]
  public bool IsFullyUnderstood =>
      IsDocument && MalformedBlockCount == 0 && UnrecognizedBlockTypes.Count == 0;
}
