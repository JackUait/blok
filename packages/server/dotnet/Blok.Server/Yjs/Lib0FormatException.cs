namespace Blok.Server.Yjs;

/// <summary>
/// Bytes that do not decode as lib0 / Yjs v1. The BCL's InvalidDataException,
/// which the rest of the server uses for refused data, is sealed.
/// </summary>
internal sealed class Lib0FormatException(string message) : FormatException(message);
