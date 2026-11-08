using System.Security.Cryptography;

namespace Blok.Server.Agent;

/// <summary>New page ids, in the shape the editor mints them.</summary>
internal static class BlokPageIds
{
  // src/shared/mint-id.ts's alphabet, so ids look the same.
  private const string Alphabet = "57X6y3wQZNzYjJB2L_10pxbackgroundhimselfUTF-8DEMOGRAPHICSVqvt4KW9";

  internal static string Mint()
  {
    return string.Concat(RandomNumberGenerator.GetBytes(10).Select(b => Alphabet[b & 63]));
  }
}
