namespace Blok.Server.Storage;

internal sealed class ForeignBlobUrlException(string url)
    : Exception($"Blob URL was not produced by this store: {url}");
