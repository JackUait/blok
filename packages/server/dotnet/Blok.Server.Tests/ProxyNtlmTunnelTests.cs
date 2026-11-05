using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Numerics;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Xunit;

// MD4, MD5, HMAC-MD5 and RC4 are NTLM's own, not a choice made here.
#pragma warning disable CA5351

namespace Blok.Server.Tests;

// The NTLM and Negotiate answer SocketsHttpHandler gives a proxy's CONNECT
// challenge, which the Go and Rust operator clients copy. On macOS .NET uses
// its managed NTLMv2 (NegotiateAuthenticationPal.ManagedNtlm), and Negotiate
// is SPNEGO around it when no Kerberos ticket is cached. The proxy sends a
// fixed challenge and checks the Type 3 with the password; NTLMv2 is
// deterministic given the password and the messages. The log masks only the
// random parts: the client challenge (CC) and the workstation (W).
public sealed partial class ProxyConnectTunnelTests
{
  [Theory]
  [InlineData("ntlm", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("negotiate", "u", "", "p", "200 ok|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}|1 auth=Negotiate resp a1/30/a2:04,a3:04 T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok mlmic=ok")]
  [InlineData("domain", "u", "DOM", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=358 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=DOM@336 ws=W@342 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  // A blank user or password: no token, so the 407 is the answer.
  [InlineData("empty", "u", "", "", "error 407|1 auth=no")]
  [InlineData("sharp", "ß", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=ß@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("dotless", "ıſ", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=354 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=ıſ@334 dom=@338 ws=W@338 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  // A Type 2 without a required flag, or without both NetBIOS names: no Type 3.
  [InlineData("flags", "u", "", "p", "error 407|1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("no-nb", "u", "", "p", "error 407|1 auth=no|1 auth=NTLM T1 {T1}")]
  // No Type 2, a short one, or bad base64: .NET throws, not an HttpRequestException.
  // A bare Negotiate is a token SPNEGO cannot read: no answer, so the 407.
  [InlineData("negotiate-bare", "u", "", "p", "error 407|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}")]
  [InlineData("bare", "u", "", "p", "throw ArgumentOutOfRangeException|1 auth=no|1 auth=NTLM T1 {T1}")]
  // A target info pair 9 or 10 from the server: ProcessTargetInfo then returns the
  // tail of its buffer (AsSpan(offset)), so the blob carries no pairs at all.
  [InlineData("av9", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=194 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=64@112 user=u@176 dom=@178 ws=W@178 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs=0: proof=ok mic=ok")]
  // A first 407 that closes: Type 1 goes on a new conn. A Type 2 that closes:
  // the Type 3 goes on the dead conn and fails.
  [InlineData("close1", "u", "", "p", "200 ok|1 auth=no|2 auth=NTLM T1 {T1}|2 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("close2", "u", "", "p", "error |1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("short", "u", "", "p", "throw ArgumentOutOfRangeException|1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("base64", "u", "", "p", "throw FormatException|1 auth=no|1 auth=NTLM T1 {T1}")]
  // Over TLS to an https proxy the channel binding pair is still zero.
  [InlineData("https", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("localhost", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/localhost,10:zero,6:02000000,0: proof=ok mic=ok")]
  // A name is Dns.GetHostEntryAsync's HostName, the canonical name: here the
  // /etc/hosts entry's own spelling.
  [InlineData("upper", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/localhost,10:zero,6:02000000,0: proof=ok mic=ok")]
  // An IPv6 proxy is named without brackets.
  [InlineData("ipv6", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=340 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=210@112 user=u@322 dom=@324 ws=W@324 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/::1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("negotiate-https", "u", "", "p", "200 ok|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}|1 auth=Negotiate resp a1/30/a2:04,a3:04 T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok mlmic=ok")]
  // How each 407 of the handshake is drained (DrainResponseAsync): one that
  // closes the conn, leaves bytes after it, runs past 1 MiB or stalls past
  // 2 s fails the request. The version plays no part.
  [InlineData("drain1-ka0", "u", "", "p", "error |1 auth=no")]
  [InlineData("drain1-extra", "u", "", "p", "error |1 auth=no")]
  [InlineData("drain1-big", "u", "", "p", "error |1 auth=no")]
  [InlineData("drain1-http10", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("drain1-body", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("drain1-closeframed", "u", "", "p", "error |1 auth=no")]
  [InlineData("drain2-ka0", "u", "", "p", "error |1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("drain2-extra", "u", "", "p", "error |1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("drain2-big", "u", "", "p", "error |1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("drain2-bigchunked", "u", "", "p", "error |1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("drain2-http10", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("drain2-chunked", "u", "", "p", "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok")]
  [InlineData("drain2-closeframed", "u", "", "p", "error |1 auth=no|1 auth=NTLM T1 {T1}")]
  [InlineData("drain2-stall", "u", "", "p", "throw IOException|1 auth=no|1 auth=NTLM T1 {T1}")]
  public async Task AnswersAnNtlmChallengeAsSocketsHttpHandlerDoes(string mode, string user, string domain, string password, string want)
  {
    var got = await RunNtlm(mode, user, domain, password);
    if (!OperatingSystem.IsMacOS())
    {
      // Elsewhere GSSAPI or SSPI makes the token, not the managed NTLM.
      Assert.DoesNotContain("Basic", got, StringComparison.Ordinal);
      return;
    }

    Assert.Equal(want.Replace("{T1}", NtlmType1, StringComparison.Ordinal).Replace("{AVS}", ServerAvs, StringComparison.Ordinal).Replace("{INIT}", SpnegoInit, StringComparison.Ordinal), got);
  }

  // The Type 1: flags 0x62888215, version 6.1.7600 revision 15.
  private const string NtlmType1 = "4e544c4d535350000100000015828862000000000000000000000000000000000601b01d0000000f";

  // SPNEGO's NegTokenInit: [APPLICATION 0] { SPNEGO OID, [0] { SEQ { [0] { NTLM },
  // [2] OCTET STRING Type 1 } } }.
  private const string SpnegoInit = "604806062b0601050502a03e303ca00e300c060a2b06010401823702020aa22a04284e544c4d535350000100000015828862000000000000000000000000000000000601b01d0000000f";

  // The proxy's target info pairs, which the Type 3 repeats before its own.
  private const string ServerAvs = "2:44004f004d00410049004e00,1:530045005200560045005200,4:64006f006d00610069006e002e007400650073007400,3:7300650072007600650072002e0064006f006d00610069006e002e007400650073007400,7:00803ed5deb19d01,";

  // NTOWFv2 upper-cases the user with ToUpperInvariant: the simple mapping,
  // except that ı keeps its case (ſ does not, unlike OrdinalIgnoreCase).
  [Fact]
  public void NtlmUpperCasesTheUserAsToUpperInvariant()
  {
    Assert.Equal("ßıSǄ", "ßıſǅ".ToUpperInvariant());
  }

  // The Type 3 names the workstation by Environment.MachineName: on macOS
  // the host name up to its first dot, case kept.
  [Fact]
  public void NtlmWorkstationIsTheHostNameUpToTheFirstDot()
  {
    if (!OperatingSystem.IsMacOS())
    {
      return;
    }

    Assert.Equal(Dns.GetHostName().Split('.')[0], Environment.MachineName);
  }

  private static async Task<string> RunNtlm(string mode, string user, string domain, string password)
  {
    using var certificate = SelfSigned();
    var target = new TcpListener(IPAddress.Loopback, 0);
    target.Start();
    _ = ServeTls(target, certificate);
    var proxy = new TcpListener(mode == "ipv6" ? IPAddress.IPv6Loopback : IPAddress.Loopback, 0);
    proxy.Start();
    var seen = new ConcurrentQueue<string>();
    var secure = mode.EndsWith("https", StringComparison.Ordinal);
    _ = ServeNtlmProxy(proxy, mode, password, ((IPEndPoint)target.LocalEndpoint).Port, secure ? certificate : null, seen);

    var host = mode switch { "localhost" => "localhost", "upper" => "LOCALHOST", "ipv6" => "[::1]", _ => "127.0.0.1" };
    using var handler = new SocketsHttpHandler
    {
      Proxy = new WebProxy($"{(secure ? "https" : "http")}://{host}:{((IPEndPoint)proxy.LocalEndpoint).Port}")
      {
        Credentials = new NetworkCredential(user, password, domain),
      },
      SslOptions = new SslClientAuthenticationOptions
      {
        RemoteCertificateValidationCallback = (_, presented, _, _) =>
            presented is not null && presented.GetCertHashString() == certificate.GetCertHashString(),
      },
    };
    using var client = new HttpClient(handler);
    string outcome;
    try
    {
      using var response = await client.GetAsync($"https://localhost:{((IPEndPoint)target.LocalEndpoint).Port}/");
      outcome = $"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}";
    }
    catch (HttpRequestException error)
    {
      outcome = $"error {(int?)error.StatusCode}";
    }
    catch (Exception error)
    {
      outcome = $"throw {error.GetType().Name}";
    }

    proxy.Stop();
    target.Stop();
    return string.Join("|", new[] { outcome }.Concat(seen));
  }

  private static readonly byte[] ServerChallenge = Convert.FromHexString("0123456789abcdef");

  private static readonly byte[] FixedTime = Convert.FromHexString("00803ed5deb19d01");

  private const uint ChallengeFlags = 0x62898215;

  private static byte[] Av(int id, byte[] value)
  {
    var pair = new byte[4 + value.Length];
    BinaryPrimitives.WriteUInt16LittleEndian(pair, (ushort)id);
    BinaryPrimitives.WriteUInt16LittleEndian(pair.AsSpan(2), (ushort)value.Length);
    value.CopyTo(pair, 4);
    return pair;
  }

  private static byte[] TargetInfo(string mode)
  {
    var pairs = new List<byte[]>
    {
      Av(2, Encoding.Unicode.GetBytes("DOMAIN")),
    };
    if (mode != "no-nb")
    {
      pairs.Add(Av(1, Encoding.Unicode.GetBytes("SERVER")));
    }

    pairs.Add(Av(4, Encoding.Unicode.GetBytes("domain.test")));
    pairs.Add(Av(3, Encoding.Unicode.GetBytes("server.domain.test")));
    pairs.Add(Av(7, FixedTime));
    if (mode == "av9")
    {
      pairs.Add(Av(9, Encoding.Unicode.GetBytes("HTTP/x")));
    }

    pairs.Add(new byte[4]);
    return pairs.SelectMany(p => p).ToArray();
  }

  private static byte[] Type2(string mode)
  {
    var name = Encoding.Unicode.GetBytes("DOMAIN");
    var info = TargetInfo(mode);
    var message = new byte[56 + name.Length + info.Length];
    "NTLMSSP\0"u8.CopyTo(message);
    message[8] = 2;
    BinaryPrimitives.WriteUInt16LittleEndian(message.AsSpan(12), (ushort)name.Length);
    BinaryPrimitives.WriteUInt16LittleEndian(message.AsSpan(14), (ushort)name.Length);
    BinaryPrimitives.WriteUInt32LittleEndian(message.AsSpan(16), 56);
    var flags = mode == "flags" ? ChallengeFlags & ~0x40000000u : ChallengeFlags;
    BinaryPrimitives.WriteUInt32LittleEndian(message.AsSpan(20), flags);
    ServerChallenge.CopyTo(message, 24);
    BinaryPrimitives.WriteUInt16LittleEndian(message.AsSpan(40), (ushort)info.Length);
    BinaryPrimitives.WriteUInt16LittleEndian(message.AsSpan(42), (ushort)info.Length);
    BinaryPrimitives.WriteUInt32LittleEndian(message.AsSpan(44), (uint)(56 + name.Length));
    Convert.FromHexString("0a0063450000000f").CopyTo(message, 48);
    name.CopyTo(message, 56);
    info.CopyTo(message, 56 + name.Length);
    return message;
  }

  // DER: one tag, its length and its content.
  private static (byte Tag, byte[] Content, int End) Der(byte[] data, int at)
  {
    var tag = data[at];
    int length = data[at + 1];
    var start = at + 2;
    if (length > 0x80)
    {
      var count = length - 0x80;
      length = 0;
      for (var i = 0; i < count; i++)
      {
        length = (length << 8) | data[start + i];
      }

      start += count;
    }

    return (tag, data[start..(start + length)], start + length);
  }

  private static byte[] DerWrap(byte tag, byte[] content)
  {
    var length = content.Length < 0x80 ? new[] { (byte)content.Length }
      : content.Length < 0x100 ? new byte[] { 0x81, (byte)content.Length }
      : new byte[] { 0x82, (byte)(content.Length >> 8), (byte)content.Length };
    return new[] { tag }.Concat(length).Concat(content).ToArray();
  }

  private static readonly byte[] NtlmOid = Convert.FromHexString("060a2b06010401823702020a");

  // A NegTokenResp: accept-incomplete, the NTLM mech and the Type 2.
  private static byte[] SpnegoChallenge(byte[] type2) =>
    DerWrap(0xa1, DerWrap(0x30, DerWrap(0xa0, Convert.FromHexString("0a0101"))
      .Concat(DerWrap(0xa1, NtlmOid))
      .Concat(DerWrap(0xa2, DerWrap(0x04, type2))).ToArray()));

  private sealed class NtlmState
  {
    public byte[]? Type1;
    public byte[]? Type2;
    public byte[]? MechList;
  }

  private static string Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(bytes);

  private static (string Text, int Length, int Offset) Field(byte[] message, int at)
  {
    var length = BinaryPrimitives.ReadUInt16LittleEndian(message.AsSpan(at));
    var offset = BinaryPrimitives.ReadInt32LittleEndian(message.AsSpan(at + 4));
    var text = offset + length <= message.Length ? Encoding.Unicode.GetString(message, offset, length) : "?";
    return (text, length, offset);
  }

  // Reads a client token: Type 1, Type 3, or SPNEGO around one. Says what
  // it saw and, for a Type 3, whether it checks with the password.
  private static (string Logged, bool Valid) ReadNtlm(string scheme, byte[] token, NtlmState state, string password)
  {
    byte[] inner = token;
    byte[]? mechListMic = null;
    var spnego = "";
    if (scheme == "Negotiate")
    {
      if (token[0] == 0x60)
      {
        // NegTokenInit: [APPLICATION 0] { OID, [0] { SEQ { [0] mechTypes, [2] token } } }
        var app = Der(token, 0).Content;
        var oid = Der(app, 0);
        var init = Der(Der(app, oid.End).Content, 0).Content;
        var mechTypes = Der(init, 0);
        state.MechList = Der(mechTypes.Content, 0) is var list ? DerWrap(list.Tag, list.Content) : null;
        inner = Der(Der(init, mechTypes.End).Content, 0).Content;
        // The whole init token is fixed, as the Type 1 is.
        spnego = $"init {Hex(token)} mechs={Hex(state.MechList!)} ";
      }
      else
      {
        // NegTokenResp: [1] { SEQ { [2] responseToken, [3] mechListMIC } }
        var outer = Der(token, 0);
        var sequence = Der(outer.Content, 0);
        var resp = sequence.Content;
        var first = Der(resp, 0);
        var firstInner = Der(first.Content, 0);
        inner = firstInner.Content;
        var tags = $"{token[0]:x2}/{outer.Content[0]:x2}/{first.Tag:x2}:{first.Content[0]:x2}";
        if (first.End < resp.Length)
        {
          var second = Der(resp, first.End);
          mechListMic = Der(second.Content, 0).Content;
          tags += $",{second.Tag:x2}:{second.Content[0]:x2}";
        }

        spnego = $"resp {tags} ";
      }
    }

    if (inner[8] == 1)
    {
      state.Type1 = inner;
      return ($"{scheme} {spnego}T1 {Hex(inner)}", false);
    }

    var t3 = inner;
    var lm = Field(t3, 12);
    var nt = Field(t3, 20);
    var dom = Field(t3, 28);
    var usr = Field(t3, 36);
    var ws = Field(t3, 44);
    var key = Field(t3, 52);
    var flags = BinaryPrimitives.ReadUInt32LittleEndian(t3.AsSpan(60));
    var response = t3.AsSpan(nt.Offset, nt.Length).ToArray();
    var blob = response[16..];
    var lmZero = t3.AsSpan(lm.Offset, lm.Length).IndexOfAnyExcept((byte)0) < 0;

    // NTOWFv2 upper-cases the user only (ToUpperInvariant).
    var ntowf = HMACMD5.HashData(Md4(Encoding.Unicode.GetBytes(password)), Encoding.Unicode.GetBytes(usr.Text.ToUpperInvariant() + dom.Text));
    var proof = HMACMD5.HashData(ntowf, ServerChallenge.Concat(blob).ToArray());
    var proofOk = proof.AsSpan().SequenceEqual(response.AsSpan(0, 16));
    var exported = Rc4(HMACMD5.HashData(ntowf, proof), t3.AsSpan(key.Offset, key.Length).ToArray());
    var zeroed = t3.ToArray();
    zeroed.AsSpan(72, 16).Clear();
    var mic = HMACMD5.HashData(exported, state.Type1!.Concat(state.Type2!).Concat(zeroed).ToArray());
    var micOk = mic.AsSpan().SequenceEqual(t3.AsSpan(72, 16));

    var avs = new List<string>();
    var cbtOk = true;
    var at = 28;
    while (at + 4 <= blob.Length)
    {
      int id = BinaryPrimitives.ReadUInt16LittleEndian(blob.AsSpan(at));
      int length = BinaryPrimitives.ReadUInt16LittleEndian(blob.AsSpan(at + 2));
      var value = blob.AsSpan(at + 4, Math.Min(length, blob.Length - at - 4));
      if (id == 10)
      {
        // No channel binding, even over TLS to an https proxy: the CONNECT
        // conn has no TransportContext.
        cbtOk = value.Length == 16 && value.IndexOfAnyExcept((byte)0) < 0;
        avs.Add(cbtOk ? "10:zero" : $"10:{Hex(value)}");
      }
      else if (id == 9)
      {
        avs.Add($"9:{Encoding.Unicode.GetString(value)}");
      }
      else
      {
        avs.Add($"{id}:{Hex(value)}");
      }

      at += 4 + length;
      if (id == 0)
      {
        break;
      }
    }

    var mlmic = "";
    var mlmicOk = true;
    if (scheme == "Negotiate")
    {
      var signKey = MD5.HashData(exported.Concat("session key to client-to-server signing key magic constant\0"u8.ToArray()).ToArray());
      var sealKey = MD5.HashData(exported.Concat("session key to client-to-server sealing key magic constant\0"u8.ToArray()).ToArray());
      var checksum = HMACMD5.HashData(signKey, new byte[4].Concat(state.MechList!).ToArray());
      var want = Convert.FromHexString("01000000").Concat(Rc4(sealKey, checksum[..8])).Concat(new byte[4]).ToArray();
      mlmicOk = mechListMic is not null && mechListMic.AsSpan().SequenceEqual(want);
      mlmic = mechListMic is null ? " mlmic=none" : mlmicOk ? " mlmic=ok" : " mlmic=bad";
    }

    var workstation = ws.Text == Environment.MachineName ? "W" : ws.Text;
    var logged = string.Create(CultureInfo.InvariantCulture,
      $"{scheme} {spnego}T3 len={t3.Length - ws.Length} flags={flags:x8} ver={Hex(t3.AsSpan(64, 8))} lm={lm.Length}@{lm.Offset}{(lmZero ? ":0" : ":x")} nt={nt.Length}@{nt.Offset} user={usr.Text}@{usr.Offset} dom={dom.Text}@{dom.Offset} ws={workstation}@{ws.Offset} key={key.Length}@ws+{key.Offset - ws.Offset - ws.Length} head={Hex(blob.AsSpan(0, 16))} cc={(blob.AsSpan(24, 4).IndexOfAnyExcept((byte)0) < 0 ? "CC" : "?")} avs={string.Join(",", avs)} proof={(proofOk ? "ok" : "bad")} mic={(micOk ? "ok" : "bad")}{mlmic}");
    return (logged, proofOk && micOk && cbtOk && mlmicOk);
  }

  // The version and what follows the challenge in a drain row's 407: the
  // first (drain1-) or the Type 2 (drain2-). Every other 407 is empty.
  private static (string Version, string Tail) DrainShape(string mode, bool first)
  {
    var prefix = first ? "drain1-" : "drain2-";
    if (!mode.StartsWith(prefix, StringComparison.Ordinal))
    {
      return ("1.1", "Content-Length: 0\r\n\r\n");
    }

    return mode[prefix.Length..] switch
    {
      "ka0" => ("1.1", "Keep-Alive: max=0\r\nContent-Length: 0\r\n\r\n"),
      "extra" => ("1.1", "Content-Length: 0\r\n\r\nxyz"),
      "big" => ("1.1", "Content-Length: 2097152\r\n\r\n" + new string('a', 2097152)),
      "bigchunked" => ("1.1", "Transfer-Encoding: chunked\r\n\r\n200000\r\n" + new string('a', 2097152) + "\r\n0\r\n\r\n"),
      "http10" => ("1.0", "Content-Length: 0\r\n\r\n"),
      "body" => ("1.1", "Content-Length: 3\r\n\r\nabc"),
      "chunked" => ("1.1", "Transfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n"),
      "closeframed" => ("1.1", "\r\nabc"),
      "stall" => ("1.1", "Content-Length: 10\r\n\r\nabc"),
      _ => throw new ArgumentException(mode),
    };
  }

  private static async Task ServeNtlmProxy(TcpListener listener, string mode, string password, int targetPort, X509Certificate2? certificate, ConcurrentQueue<string> seen)
  {
    var scheme = mode.StartsWith("negotiate", StringComparison.Ordinal) ? "Negotiate" : "NTLM";
    var connections = 0;
    while (true)
    {
      TcpClient client;
      try
      {
        client = await listener.AcceptTcpClientAsync();
      }
      catch (Exception)
      {
        return;
      }

      var id = Interlocked.Increment(ref connections);
      _ = Task.Run(async () =>
      {
        using var _ = client;
        Stream stream = client.GetStream();
        try
        {
          if (certificate is not null)
          {
            var tls = new SslStream(stream);
            await tls.AuthenticateAsServerAsync(certificate);
            stream = tls;
          }

          var state = new NtlmState();
          for (var round = 0; round < 4; round++)
          {
            var head = await ReadHead(stream);
            if (head is null)
            {
              return;
            }

            var auth = head.Split("\r\n")
                .FirstOrDefault(line => line.StartsWith("Proxy-Authorization:", StringComparison.OrdinalIgnoreCase))?["Proxy-Authorization:".Length..].Trim();
            string answer;
            var close = false;
            if (auth is null)
            {
              seen.Enqueue($"{id} auth=no");
              close = mode == "close1";
              answer = $"Proxy-Authenticate: {scheme}\r\n";
            }
            else
            {
              var space = auth.IndexOf(' ', StringComparison.Ordinal);
              var (logged, valid) = ReadNtlm(auth[..space], Convert.FromBase64String(auth[(space + 1)..]), state, password);
              seen.Enqueue($"{id} auth={logged}");
              if (valid)
              {
                await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 Connection established\r\n\r\n"));
                using var upstream = new TcpClient();
                await upstream.ConnectAsync(IPAddress.Loopback, targetPort);
                var remote = upstream.GetStream();
                await Task.WhenAny(stream.CopyToAsync(remote), remote.CopyToAsync(stream));
                return;
              }

              if (state.Type1 is null || state.Type2 is not null)
              {
                answer = "";
              }
              else
              {
                state.Type2 = Type2(mode);
                close = mode == "close2";
                var data = mode switch
                {
                  "bare" or "negotiate-bare" => "",
                  "short" => " " + Convert.ToBase64String(state.Type2[..10]),
                  "base64" => " !!!",
                  _ => " " + Convert.ToBase64String(scheme == "Negotiate" ? SpnegoChallenge(state.Type2) : state.Type2),
                };
                answer = $"Proxy-Authenticate: {scheme}{data}\r\n";
              }
            }

            var (status, tail) = DrainShape(mode, auth is null);
            await stream.WriteAsync(Encoding.ASCII.GetBytes(
                $"HTTP/{status} 407 Proxy Authentication Required\r\n" + answer + (close ? "Connection: close\r\n" : "") + tail));
            if (close)
            {
              return;
            }
          }
        }
        catch (Exception error)
        {
          seen.Enqueue($"{id} proxy {error.GetType().Name}");
        }
      });
    }
  }

  // .NET keeps its MD4 and RC4 internal.
  private static byte[] Md4(byte[] input)
  {
    var message = new byte[((input.Length + 8) / 64 + 1) * 64];
    input.CopyTo(message, 0);
    message[input.Length] = 0x80;
    BinaryPrimitives.WriteUInt64LittleEndian(message.AsSpan(message.Length - 8), (ulong)input.Length * 8);
    uint a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
    var x = new uint[16];
    for (var block = 0; block < message.Length; block += 64)
    {
      for (var i = 0; i < 16; i++)
      {
        x[i] = BinaryPrimitives.ReadUInt32LittleEndian(message.AsSpan(block + i * 4));
      }

      uint aa = a, bb = b, cc = c, dd = d;
      int[] s1 = [3, 7, 11, 19], s2 = [3, 5, 9, 13], s3 = [3, 9, 11, 15];
      int[] o3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
      for (var i = 0; i < 16; i++)
      {
        var f = (b & c) | (~b & d);
        var t = BitOperations.RotateLeft(a + f + x[i], s1[i % 4]);
        (a, b, c, d) = (d, t, b, c);
      }

      for (var i = 0; i < 16; i++)
      {
        var g = (b & c) | (b & d) | (c & d);
        var t = BitOperations.RotateLeft(a + g + x[(i % 4) * 4 + i / 4] + 0x5a827999, s2[i % 4]);
        (a, b, c, d) = (d, t, b, c);
      }

      for (var i = 0; i < 16; i++)
      {
        var h = b ^ c ^ d;
        var t = BitOperations.RotateLeft(a + h + x[o3[i]] + 0x6ed9eba1, s3[i % 4]);
        (a, b, c, d) = (d, t, b, c);
      }

      a += aa;
      b += bb;
      c += cc;
      d += dd;
    }

    var digest = new byte[16];
    BinaryPrimitives.WriteUInt32LittleEndian(digest, a);
    BinaryPrimitives.WriteUInt32LittleEndian(digest.AsSpan(4), b);
    BinaryPrimitives.WriteUInt32LittleEndian(digest.AsSpan(8), c);
    BinaryPrimitives.WriteUInt32LittleEndian(digest.AsSpan(12), d);
    return digest;
  }

  private static byte[] Rc4(byte[] key, byte[] data)
  {
    var s = Enumerable.Range(0, 256).Select(i => (byte)i).ToArray();
    for (int i = 0, j = 0; i < 256; i++)
    {
      j = (j + s[i] + key[i % key.Length]) & 0xff;
      (s[i], s[j]) = (s[j], s[i]);
    }

    var output = new byte[data.Length];
    for (int n = 0, i = 0, j = 0; n < data.Length; n++)
    {
      i = (i + 1) & 0xff;
      j = (j + s[i]) & 0xff;
      (s[i], s[j]) = (s[j], s[i]);
      output[n] = (byte)(data[n] ^ s[(s[i] + s[j]) & 0xff]);
    }

    return output;
  }

  [Fact]
  public void NtlmVerifierPrimitivesMatchTheRfcAndSpecVectors()
  {
    Assert.Equal("a448017aaf21d8525fc10ae87aa6729d", Hex(Md4("abc"u8.ToArray())));
    Assert.Equal("31d6cfe0d16ae931b73c59d7e0c089c0", Hex(Md4([])));
    Assert.Equal("b2396305f03dc027ccc3524a0a1118a8", Hex(Rc4(Convert.FromHexString("0102030405"), new byte[16])));
    // MS-NLMP 4.2.4.1.1: NTOWFv2("Password", "User", "Domain").
    var ntowf = HMACMD5.HashData(Md4(Encoding.Unicode.GetBytes("Password")), Encoding.Unicode.GetBytes("USERDomain"));
    Assert.Equal("0c868a403bfd7a93a3001ef22ef02e3f", Hex(ntowf));
  }
}
