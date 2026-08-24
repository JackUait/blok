using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Org.BouncyCastle.Tls;
using Org.BouncyCastle.Tls.Crypto.Impl.BC;

namespace Blok.Server.Outbound;

internal static class MacOsTlsTransport
{
  internal static async ValueTask<Stream> AuthenticateAsync(
      NetworkStream network,
      string host,
      X509Certificate2Collection? customTrustRoots,
      CancellationToken cancellationToken)
  {
    var protocol = new TlsClientProtocol(network);
    using var registration = cancellationToken.Register(
        static state => ((NetworkStream)state!).Dispose(),
        network);

    try
    {
      await Task.Run(
          () => protocol.Connect(
              new Client(host, customTrustRoots)),
          CancellationToken.None).WaitAsync(cancellationToken);
      cancellationToken.ThrowIfCancellationRequested();

      return new InterruptibleStream(
          protocol.Stream,
          network);
    }
    catch
    {
      network.Dispose();
      throw;
    }
  }

  private sealed class Client(
      string host,
      X509Certificate2Collection? customTrustRoots) :
      DefaultTlsClient(new BcTlsCrypto())
  {
    protected override IList<ProtocolName> GetProtocolNames()
    {
      return [ProtocolName.Http_1_1];
    }

    protected override IList<ServerName>? GetSniServerNames()
    {
      if (IPAddress.TryParse(
          host.Trim('[', ']'),
          out _))
      {
        return null;
      }

      return
      [
        new ServerName(
            NameType.host_name,
            Encoding.ASCII.GetBytes(host)),
      ];
    }

    public override TlsAuthentication GetAuthentication()
    {
      return new Authentication(host, customTrustRoots);
    }
  }

  private sealed class Authentication(
      string host,
      X509Certificate2Collection? customTrustRoots) :
      TlsAuthentication
  {
    public TlsCredentials? GetClientCredentials(
        Org.BouncyCastle.Tls.CertificateRequest certificateRequest)
    {
      _ = certificateRequest;
      return null;
    }

    public void NotifyServerCertificate(
        TlsServerCertificate serverCertificate)
    {
      var chain = serverCertificate.Certificate
          .GetCertificateList()
          .Select(certificate => certificate.GetEncoded())
          .ToArray();

      if (!MacOsCertificateTrust.IsTrusted(
          chain,
          host,
          customTrustRoots))
      {
        throw new TlsFatalAlert(
            AlertDescription.bad_certificate);
      }
    }
  }

  private sealed class InterruptibleStream(
      Stream tls,
      NetworkStream network) : Stream
  {
    private int disposed;

    public override bool CanRead => tls.CanRead;

    public override bool CanSeek => false;

    public override bool CanWrite => tls.CanWrite;

    public override long Length =>
        throw new NotSupportedException();

    public override long Position
    {
      get => throw new NotSupportedException();
      set => throw new NotSupportedException();
    }

    public override void Flush()
    {
      tls.Flush();
    }

    public override Task FlushAsync(
        CancellationToken cancellationToken)
    {
      return RunInterruptiblyAsync(
          () => new ValueTask(
              tls.FlushAsync(cancellationToken)),
          cancellationToken).AsTask();
    }

    public override int Read(
        byte[] buffer,
        int offset,
        int count)
    {
      return tls.Read(buffer, offset, count);
    }

    public override int Read(Span<byte> buffer)
    {
      return tls.Read(buffer);
    }

    public override Task<int> ReadAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
      return ReadAsync(
          buffer.AsMemory(offset, count),
          cancellationToken).AsTask();
    }

    public override ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      return RunInterruptiblyAsync(
          () => tls.ReadAsync(
              buffer,
              cancellationToken),
          cancellationToken);
    }

    public override long Seek(
        long offset,
        SeekOrigin origin)
    {
      throw new NotSupportedException();
    }

    public override void SetLength(long value)
    {
      throw new NotSupportedException();
    }

    public override void Write(
        byte[] buffer,
        int offset,
        int count)
    {
      tls.Write(buffer, offset, count);
    }

    public override void Write(
        ReadOnlySpan<byte> buffer)
    {
      tls.Write(buffer);
    }

    public override Task WriteAsync(
        byte[] buffer,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
      return WriteAsync(
          buffer.AsMemory(offset, count),
          cancellationToken).AsTask();
    }

    public override ValueTask WriteAsync(
        ReadOnlyMemory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
      return RunInterruptiblyAsync(
          () => tls.WriteAsync(
              buffer,
              cancellationToken),
          cancellationToken);
    }

    protected override void Dispose(bool disposing)
    {
      if (disposing &&
          Interlocked.Exchange(ref disposed, 1) == 0)
      {
        try
        {
          tls.Dispose();
        }
        finally
        {
          network.Dispose();
        }
      }

      base.Dispose(disposing);
    }

    private async ValueTask<T> RunInterruptiblyAsync<T>(
        Func<ValueTask<T>> operation,
        CancellationToken cancellationToken)
    {
      using var registration = RegisterCancellation(
          cancellationToken);

      try
      {
        return await operation();
      }
      catch (Exception) when (
          cancellationToken.IsCancellationRequested)
      {
        throw new OperationCanceledException(
            cancellationToken);
      }
    }

    private async ValueTask RunInterruptiblyAsync(
        Func<ValueTask> operation,
        CancellationToken cancellationToken)
    {
      using var registration = RegisterCancellation(
          cancellationToken);

      try
      {
        await operation();
      }
      catch (Exception) when (
          cancellationToken.IsCancellationRequested)
      {
        throw new OperationCanceledException(
            cancellationToken);
      }
    }

    private CancellationTokenRegistration RegisterCancellation(
        CancellationToken cancellationToken)
    {
      return cancellationToken.Register(
          static state => ((NetworkStream)state!).Dispose(),
          network);
    }
  }
}

internal static class MacOsCertificateTrust
{
  private const string CoreFoundation =
      "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
  private const string Security =
      "/System/Library/Frameworks/Security.framework/Security";
  private const uint Utf8Encoding = 0x08000100;

  internal static bool IsTrusted(
      IReadOnlyList<byte[]> chain,
      string host,
      X509Certificate2Collection? customTrustRoots)
  {
    if (chain.Count == 0)
    {
      return false;
    }

    var certificateHandles = CreateCertificates(chain);
    var anchorHandles = customTrustRoots is null
      ? []
      : CreateCertificates(
          customTrustRoots
              .Select(certificate => certificate.RawData)
              .ToArray());
    nint certificates = 0;
    nint anchors = 0;
    nint hostName = 0;
    nint policy = 0;
    nint trust = 0;
    nint error = 0;

    try
    {
      if (certificateHandles.Any(handle => handle == 0) ||
          anchorHandles.Any(handle => handle == 0))
      {
        return false;
      }

      certificates = CFArrayCreate(
          0,
          certificateHandles,
          certificateHandles.Length,
          0);
      hostName = CFStringCreateWithCString(
          0,
          host,
          Utf8Encoding);
      policy = SecPolicyCreateSSL(
          server: true,
          hostName);
      if (certificates == 0 ||
          hostName == 0 ||
          policy == 0 ||
          SecTrustCreateWithCertificates(
              certificates,
              policy,
              out trust) != 0 ||
          trust == 0 ||
          SecTrustSetNetworkFetchAllowed(
              trust,
              allowFetch: false) != 0)
      {
        return false;
      }

      if (customTrustRoots is not null)
      {
        anchors = CFArrayCreate(
            0,
            anchorHandles,
            anchorHandles.Length,
            0);
        if (anchors == 0 ||
            SecTrustSetAnchorCertificates(
                trust,
                anchors) != 0 ||
            SecTrustSetAnchorCertificatesOnly(
                trust,
                anchorCertificatesOnly: true) != 0)
        {
          return false;
        }
      }

      return SecTrustEvaluateWithError(
          trust,
          out error);
    }
    finally
    {
      Release(error);
      Release(trust);
      Release(policy);
      Release(hostName);
      Release(anchors);
      Release(certificates);

      foreach (var handle in anchorHandles)
      {
        Release(handle);
      }

      foreach (var handle in certificateHandles)
      {
        Release(handle);
      }
    }
  }

  private static nint[] CreateCertificates(
      IReadOnlyList<byte[]> certificates)
  {
    var handles = new nint[certificates.Count];

    for (var index = 0; index < certificates.Count; index++)
    {
      var data = CFDataCreate(
          0,
          certificates[index],
          certificates[index].Length);

      try
      {
        if (data != 0)
        {
          handles[index] = SecCertificateCreateWithData(
              0,
              data);
        }
      }
      finally
      {
        Release(data);
      }
    }

    return handles;
  }

  private static void Release(nint handle)
  {
    if (handle != 0)
    {
      CFRelease(handle);
    }
  }

  [DllImport(CoreFoundation)]
  private static extern nint CFArrayCreate(
      nint allocator,
      [In] nint[] values,
      nint count,
      nint callbacks);

  [DllImport(CoreFoundation)]
  private static extern nint CFDataCreate(
      nint allocator,
      [In] byte[] bytes,
      nint length);

  [DllImport(CoreFoundation)]
  private static extern void CFRelease(nint value);

  [DllImport(CoreFoundation)]
  private static extern nint CFStringCreateWithCString(
      nint allocator,
      [MarshalAs(UnmanagedType.LPUTF8Str)] string value,
      uint encoding);

  [DllImport(Security)]
  private static extern nint SecCertificateCreateWithData(
      nint allocator,
      nint data);

  [DllImport(Security)]
  private static extern nint SecPolicyCreateSSL(
      [MarshalAs(UnmanagedType.I1)] bool server,
      nint hostName);

  [DllImport(Security)]
  private static extern int SecTrustCreateWithCertificates(
      nint certificates,
      nint policies,
      out nint trust);

  [DllImport(Security)]
  private static extern int SecTrustSetAnchorCertificates(
      nint trust,
      nint anchorCertificates);

  [DllImport(Security)]
  private static extern int SecTrustSetAnchorCertificatesOnly(
      nint trust,
      [MarshalAs(UnmanagedType.I1)] bool anchorCertificatesOnly);

  [DllImport(Security)]
  private static extern int SecTrustSetNetworkFetchAllowed(
      nint trust,
      [MarshalAs(UnmanagedType.I1)] bool allowFetch);

  [DllImport(Security)]
  [return: MarshalAs(UnmanagedType.I1)]
  private static extern bool SecTrustEvaluateWithError(
      nint trust,
      out nint error);
}
