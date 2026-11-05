using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Outbound;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/macos-trust-chains.json,
/// which Go and Rust read too. Each row is a chain under one test root and
/// what trustd makes of it on macOS, through the two C# paths: the guarded
/// fetcher's MacOsCertificateTrust, and SslStream with HttpClient's
/// defaults, which the S3 and doc-endpoint clients use. Run with
/// BLOK_WRITE_FIXTURES=1 on macOS to rewrite the answers.
/// </summary>
public sealed class MacOsTrustChainFixtureTests
{
  private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

  [Fact]
  public async Task TrustsTheChainsTheFixtureLists()
  {
    if (!OperatingSystem.IsMacOS())
    {
      return;
    }

    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/macos-trust-chains.json");
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var cases = fixture["cases"]!.AsArray();
    using var rootKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    using var root = CreateRoot(rootKey);

    var wrong = new List<string>();
    foreach (var entry in cases)
    {
      var row = entry!.AsObject();
      var host = row["host"]!.GetValue<string>();
      var chain = BuildChain(row, root, rootKey, out var leaf, out var sent);
      using (leaf)
      {
        var guarded = MacOsCertificateTrust.IsTrusted(
            sent,
            host,
            new X509Certificate2Collection(root)) ? "accept" : "refuse";
        var operatorVerdict = await OperatorVerdict(leaf, chain, root, host);

        if (Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1")
        {
          row["guarded"] = guarded;
          row["operator"] = operatorVerdict;
        }
        else if (row["guarded"]?.GetValue<string>() != guarded ||
            row["operator"]?.GetValue<string>() != operatorVerdict)
        {
          wrong.Add($"{row["name"]}: guarded {guarded}, operator {operatorVerdict}");
        }
      }
    }

    if (Environment.GetEnvironmentVariable("BLOK_WRITE_FIXTURES") == "1")
    {
      File.WriteAllText(
          path,
          fixture.ToJsonString(new JsonSerializerOptions
          {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
          }) + "\n");
      return;
    }

    Assert.Empty(wrong);
  }

  private static X509Certificate2 CreateRoot(ECDsa key)
  {
    var request = new CertificateRequest("CN=Blok Trust Test Root", key, HashAlgorithmName.SHA256);
    request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
    request.CertificateExtensions.Add(new X509KeyUsageExtension(
        X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign,
        true));
    request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
    return request.CreateSelfSigned(Now.AddDays(-30), Now.AddDays(3650));
  }

  private static X509Certificate2Collection BuildChain(
      JsonObject row,
      X509Certificate2 root,
      ECDsa rootKey,
      out X509Certificate2 leaf,
      out byte[][] sent)
  {
    var issuer = root;
    var issuerKey = rootKey;
    X509Certificate2? intermediate = null;
    using var intermediateKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var spec = row["intermediate"]?.AsObject();
    if (spec is not null)
    {
      var request = new CertificateRequest("CN=Blok Trust Test Intermediate", intermediateKey, HashAlgorithmName.SHA256);
      if (spec["ca"]?.GetValue<bool>() ?? true)
      {
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign,
            true));
      }
      AddUsages(request, spec, defaultUsage: false);
      request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
      request.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(root, true, false));
      intermediate = request.Create(root, Now.AddDays(-2), Now.AddDays(1000), [2]);
      issuer = intermediate;
      issuerKey = intermediateKey;
    }

    var leafSpec = row["leaf"]!.AsObject();
    var cn = leafSpec["cn"]?.GetValue<string>() ?? "x";
    using var rsa = leafSpec["key"]?.GetValue<string>() == "rsa1024" ? RSA.Create(1024) : null;
    using var ec = rsa is null ? ECDsa.Create(ECCurve.NamedCurves.nistP256) : null;
    var leafRequest = rsa is not null
      ? new CertificateRequest($"CN={cn}", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
      : new CertificateRequest($"CN={cn}", ec!, HashAlgorithmName.SHA256);
    var isCa = leafSpec["ca"]?.GetValue<bool>() ?? false;
    leafRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(isCa, false, 0, true));
    if (!isCa)
    {
      leafRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
    }
    AddUsages(leafRequest, leafSpec, defaultUsage: true);
    var names = new SubjectAlternativeNameBuilder();
    var anyName = false;
    foreach (var dns in leafSpec["dns"]?.AsArray() ?? [])
    {
      names.AddDnsName(dns!.GetValue<string>());
      anyName = true;
    }
    foreach (var ip in leafSpec["ips"]?.AsArray() ?? [])
    {
      names.AddIpAddress(IPAddress.Parse(ip!.GetValue<string>()));
      anyName = true;
    }
    if (anyName)
    {
      leafRequest.CertificateExtensions.Add(names.Build());
    }
    leafRequest.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(leafRequest.PublicKey, false));
    leafRequest.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(issuer, true, false));
    var start = Now.AddDays(leafSpec["start"]?.GetValue<int>() ?? -1);
    var end = start.AddDays(leafSpec["days"]?.GetValue<int>() ?? 365);
    using var signed = leafRequest.Create(
        issuer.SubjectName,
        X509SignatureGenerator.CreateForECDsa(issuerKey),
        start,
        end,
        [3]);
    leaf = rsa is not null ? signed.CopyWithPrivateKey(rsa) : signed.CopyWithPrivateKey(ec!);

    var chain = new X509Certificate2Collection();
    var sentList = new List<byte[]> { leaf.RawData };
    if (intermediate is not null && (spec!["sent"]?.GetValue<bool>() ?? true))
    {
      chain.Add(intermediate);
      sentList.Add(intermediate.RawData);
    }
    sent = sentList.ToArray();
    return chain;
  }

  private static void AddUsages(CertificateRequest request, JsonObject spec, bool defaultUsage)
  {
    var usages = spec.ContainsKey("eku")
      ? spec["eku"]?.AsArray().Select(value => value!.GetValue<string>()).ToArray()
      : defaultUsage ? ["serverAuth"] : null;
    if (usages is null)
    {
      return;
    }
    var oids = new OidCollection();
    foreach (var usage in usages)
    {
      oids.Add(new Oid(usage switch
      {
        "serverAuth" => "1.3.6.1.5.5.7.3.1",
        "clientAuth" => "1.3.6.1.5.5.7.3.2",
        "any" => "2.5.29.37.0",
        _ => throw new ArgumentException(usage),
      }));
    }
    request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(oids, false));
  }

  // SslStream's own check with HttpClient's defaults (revocation off,
  // downloads on), the root standing in for the system roots.
  private static async Task<string> OperatorVerdict(
      X509Certificate2 leaf,
      X509Certificate2Collection chain,
      X509Certificate2 root,
      string host)
  {
    using var serverLeaf = X509CertificateLoader.LoadPkcs12(leaf.Export(X509ContentType.Pkcs12), null);
    var context = SslStreamCertificateContext.Create(serverLeaf, chain, offline: true);
    using var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var port = ((IPEndPoint)listener.LocalEndpoint).Port;
    var server = Task.Run(async () =>
    {
      using var socket = await listener.AcceptSocketAsync();
      await using var stream = new SslStream(new NetworkStream(socket, ownsSocket: true));
      try
      {
        await stream.AuthenticateAsServerAsync(new SslServerAuthenticationOptions
        {
          ServerCertificateContext = context,
        });
      }
      catch (Exception)
      {
      }
    });

    var policy = new X509ChainPolicy
    {
      RevocationMode = X509RevocationMode.NoCheck,
      RevocationFlag = X509RevocationFlag.ExcludeRoot,
      TrustMode = X509ChainTrustMode.CustomRootTrust,
    };
    policy.CustomTrustStore.Add(root);
    string verdict;
    try
    {
      using var client = new TcpClient();
      await client.ConnectAsync(IPAddress.Loopback, port);
      await using var tls = new SslStream(client.GetStream(), leaveInnerStreamOpen: false);
      await tls.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
      {
        TargetHost = host,
        CertificateChainPolicy = policy,
      });
      verdict = "accept";
    }
    catch (Exception)
    {
      verdict = "refuse";
    }

    await server;
    return verdict;
  }
}
