namespace Blok.Server.Storage;

internal interface IBlobStore
{
  Task<string> PutAsync(
      string extension,
      string mimeType,
      Stream content,
      CancellationToken cancellationToken = default);

  Task DeleteAsync(
      string url,
      CancellationToken cancellationToken = default);
}
