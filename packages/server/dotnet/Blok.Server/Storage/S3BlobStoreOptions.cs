namespace Blok.Server.Storage;

internal sealed record S3BlobStoreOptions(
    string Endpoint,
    string Region,
    string Bucket,
    string AccessKey,
    string SecretKey,
    string PublicUrl,
    string AddressingStyle,
    long MaximumSpoolBytes,
    string TemporaryDirectory,
    TimeSpan RequestTimeout = default,
    TimeSpan ResponseHeaderTimeout = default);
