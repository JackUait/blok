using System.Security.Cryptography;
using System.Text;

namespace Blok.Server.Collab;

/// <summary>
/// Doc ids are opaque consumer strings, so they are hashed (SHA-256, lower
/// hex) rather than encoded into file/key names: every id becomes path- and
/// key-safe, fixed-length, and collision-free on case-insensitive
/// filesystems. The trade-off — a stored blob cannot be mapped back to its
/// doc id by name — is fine for a private working set.
/// </summary>
internal static class CollabDocKey
{
  internal static string For(string docId)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    return Convert.ToHexStringLower(
        SHA256.HashData(Encoding.UTF8.GetBytes(docId)));
  }
}
