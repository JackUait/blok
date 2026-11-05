//! The NTLMv2 and SPNEGO client .NET runs on macOS for a proxy's NTLM or
//! Negotiate challenge: ManagedNtlmNegotiateAuthenticationPal and
//! ManagedSpnegoNegotiateAuthenticationPal (System.Net.Security 10.0.11,
//! decompiled, NegotiateAuthenticationPal.cs:645-1640). Pinned by C#'s
//! AnswersAnNtlmChallengeAsSocketsHttpHandlerDoes. No LM, no NTLMv1, no
//! Kerberos: without a ticket .NET offers NTLM only.

use ring::rand::{SecureRandom, SystemRandom};

use crate::digest::md5;

/// Where .NET throws out of the handshake: the request fails without a
/// status.
#[derive(Debug, PartialEq)]
pub(crate) struct Throw;

/// Unicode, TargetName, Sign, NTLM, AlwaysSign, NTLM2, TargetInfo,
/// Version, 128 and KeyExchange: sent, and required of the server.
const FLAGS: u32 = 0x6288_8215;
const SEAL: u32 = 0x20;
const SIGN: u32 = 0x10;
/// 6.1.7600, revision 15.
const VERSION: [u8; 8] = [6, 1, 0xb0, 0x1d, 0, 0, 0, 0x0f];
const NTLM_OID: [u8; 12] = [
    0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a,
];
const SPNEGO_OID: [u8; 8] = [0x06, 0x06, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x02];
/// 1.2.840.113554.1.2.2's content.
const KERBEROS_OID: [u8; 9] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x12, 0x01, 0x02, 0x02];
pub(crate) const SIGN_MAGIC: &[u8] =
    b"session key to client-to-server signing key magic constant\0";
pub(crate) const SEAL_MAGIC: &[u8] =
    b"session key to client-to-server sealing key magic constant\0";
/// The proxy's side, for VerifyMIC.
const SERVER_SIGN_MAGIC: &[u8] = b"session key to server-to-client signing key magic constant\0";
const SERVER_SEAL_MAGIC: &[u8] = b"session key to server-to-client sealing key magic constant\0";

pub(crate) struct NtlmAuth {
    user: String,
    domain: String,
    password: String,
    spn: String,
    workstation: Vec<u8>,
    negotiate: bool,
    random: SystemRandom,
    type1: Vec<u8>,
    mech_list: Vec<u8>,
    exported: Vec<u8>,
    /// SPNEGO's mechanism, picked by the server's first answer.
    chosen: bool,
    /// IsAuthenticated: NTLM sets it once a challenge is answered, before
    /// it reads the challenge; SPNEGO once its state is final.
    pub(crate) authenticated: bool,
    /// VerifyMIC's sequence number.
    server_sequence: u32,
}

impl NtlmAuth {
    /// NegotiateAuthentication for package NTLM or Negotiate; None when
    /// .NET gives no token (a blank user or password).
    pub(crate) fn new(
        negotiate: bool,
        user: &str,
        domain: &str,
        password: &str,
        spn: &str,
    ) -> Option<NtlmAuth> {
        let blank = |s: &str| s.chars().all(char::is_whitespace);
        if blank(user) || blank(password) {
            return None;
        }
        Some(NtlmAuth {
            user: user.to_owned(),
            domain: domain.to_owned(),
            password: password.to_owned(),
            spn: spn.to_owned(),
            workstation: utf16le(&machine_name()),
            negotiate,
            random: SystemRandom::new(),
            type1: Vec::new(),
            mech_list: Vec::new(),
            exported: Vec::new(),
            chosen: false,
            authenticated: false,
            server_sequence: 0,
        })
    }

    /// The first token: the Type 1, or SPNEGO's NegTokenInit around it
    /// with NTLM as the only mechanism.
    pub(crate) fn initial(&mut self) -> Vec<u8> {
        let mut type1 = vec![0u8; 40];
        type1[..8].copy_from_slice(b"NTLMSSP\0");
        type1[8] = 1;
        type1[12..16].copy_from_slice(&FLAGS.to_le_bytes());
        type1[32..40].copy_from_slice(&VERSION);
        self.type1 = type1;
        if !self.negotiate {
            return self.type1.clone();
        }
        self.mech_list = der(0x30, &[&NTLM_OID]);
        der(
            0x60,
            &[
                &SPNEGO_OID,
                &der(
                    0xa0,
                    &[&der(
                        0x30,
                        &[
                            &der(0xa0, &[&self.mech_list]),
                            &der(0xa2, &[&der(0x04, &[&self.type1])]),
                        ],
                    )],
                ),
            ],
        )
    }

    /// Answers the server's challenge token (GetOutgoingBlob): the token
    /// to send, None for none, and the status.
    pub(crate) fn respond(&mut self, challenge: &[u8]) -> Result<(Option<Vec<u8>>, Status), Throw> {
        if !self.negotiate {
            self.authenticated = true;
            return Ok(match self.type3(challenge)? {
                Some(token) => (Some(token), Status::Completed),
                None => (None, Status::InvalidToken),
            });
        }
        self.spnego(challenge)
    }

    /// ProcessSpNegoChallenge.
    fn spnego(&mut self, challenge: &[u8]) -> Result<(Option<Vec<u8>>, Status), Throw> {
        let Some(resp) = read_neg_token_resp(challenge) else {
            return Ok((None, Status::InvalidToken));
        };
        let name = match &resp.mech {
            Some(mech) if mech[..] == NTLM_OID[2..] => Some("NTLM"),
            Some(mech) if mech[..] == KERBEROS_OID => Some("Kerberos"),
            _ => None,
        };
        if !self.chosen {
            // Kerberos would be a GSSAPI mechanism of its own: not ported.
            if name != Some("NTLM") {
                return Ok((None, Status::Unsupported));
            }
            self.chosen = true;
        } else if name.is_some_and(|n| n != "NTLM") {
            return Ok((None, Status::InvalidToken));
        }
        if !resp.token.is_empty() {
            let Some(type3) = self.type3(&resp.token)? else {
                return Ok((None, Status::InvalidToken));
            };
            self.server_sequence = 0;
            let mic = signature(&self.exported, 0, &self.mech_list);
            let status = if resp.neg_state == NEG_REQUEST_MIC {
                Status::Continue
            } else {
                Status::Completed
            };
            self.authenticated = status == Status::Completed;
            let token = der(
                0xa1,
                &[&der(
                    0x30,
                    &[
                        &der(0xa2, &[&der(0x04, &[&type3])]),
                        &der(0xa3, &[&der(0x04, &[&mic])]),
                    ],
                )],
            );
            return Ok((Some(token), status));
        }
        // A MIC equal to the (absent, so empty) token is not checked.
        if let Some(mic) = &resp.mic
            && *mic != resp.token
        {
            if self.mech_list.is_empty() || resp.neg_state != NEG_ACCEPT_COMPLETED {
                return Ok((None, Status::GenericFailure));
            }
            if !self.verify_mic(mic) {
                return Ok((None, Status::MessageAltered));
            }
        }
        self.authenticated = matches!(resp.neg_state, NEG_ACCEPT_COMPLETED | NEG_REJECT);
        let status = match resp.neg_state {
            NEG_ACCEPT_COMPLETED => Status::Completed,
            NEG_ACCEPT_INCOMPLETE => Status::Continue,
            NEG_REJECT => Status::UnknownCredentials,
            _ => Status::GenericFailure,
        };
        Ok((None, status))
    }

    /// VerifyMIC: CalculateSignature with the server-to-client keys, a
    /// fresh server RC4 (made when the Type 3 was) and the server's
    /// sequence number.
    fn verify_mic(&mut self, signature: &[u8]) -> bool {
        if signature.len() != 16 || signature[..4] != 1u32.to_le_bytes() || self.exported.is_empty()
        {
            return false;
        }
        let want = signature_with(
            &self.exported,
            SERVER_SIGN_MAGIC,
            SERVER_SEAL_MAGIC,
            self.server_sequence,
            &self.mech_list,
        );
        self.server_sequence = self.server_sequence.wrapping_add(1);
        want[..] == *signature
    }

    /// ProcessChallenge.
    fn type3(&mut self, blob: &[u8]) -> Result<Option<Vec<u8>>, Throw> {
        if blob.len() < 56 {
            return Err(Throw);
        }
        if blob[8] != 2 || &blob[..8] != b"NTLMSSP\0" {
            return Ok(None);
        }
        let flags = u32::from_le_bytes([blob[20], blob[21], blob[22], blob[23]]);
        // TargetName is read, and can throw, before the flags are checked.
        field(blob, 12)?;
        if flags & FLAGS != FLAGS {
            return Ok(None);
        }
        let target_info = field(blob, 40)?;
        let (info, stamp, has_nb_names) = self.target_info(target_info)?;
        if !has_nb_names && flags & (SIGN | SEAL) != 0 {
            return Ok(None);
        }
        let (user, domain) = (utf16le(&self.user), utf16le(&self.domain));
        let mut message = vec![0u8; 88];
        message[..8].copy_from_slice(b"NTLMSSP\0");
        message[8] = 3;
        message[60..64].copy_from_slice(&(FLAGS | flags & SEAL).to_le_bytes());
        message[64..72].copy_from_slice(&VERSION);
        let hash = ntowfv2(&self.user, &self.domain, &self.password)?;
        let mut client_challenge = [0u8; 8];
        self.random.fill(&mut client_challenge).map_err(|_| Throw)?;
        fn add(message: &mut Vec<u8>, at: usize, data: &[u8]) -> Result<(), Throw> {
            let length = u16::try_from(data.len())
                .ok()
                .filter(|&n| n <= 32767)
                .ok_or(Throw)?;
            let offset = u32::try_from(message.len()).map_err(|_| Throw)?;
            message[at..at + 2].copy_from_slice(&length.to_le_bytes());
            message[at + 2..at + 4].copy_from_slice(&length.to_le_bytes());
            message[at + 4..at + 8].copy_from_slice(&offset.to_le_bytes());
            message.extend_from_slice(data);
            Ok(())
        }
        add(&mut message, 12, &[0u8; 24])?;
        let response = nt_response(&hash, &blob[24..32], &client_challenge, stamp, &info);
        add(&mut message, 20, &response)?;
        add(&mut message, 36, &user)?;
        add(&mut message, 28, &domain)?;
        let workstation = self.workstation.clone();
        add(&mut message, 44, &workstation)?;
        let mut exported = [0u8; 16];
        self.random.fill(&mut exported).map_err(|_| Throw)?;
        add(
            &mut message,
            52,
            &rc4(&hmac_md5(&hash, &response[..16]), &exported),
        )?;
        let mic = hmac_md5_parts(&exported, &[&self.type1, blob, &message]);
        message[72..88].copy_from_slice(&mic);
        self.exported = exported.to_vec();
        Ok(Some(message))
    }

    /// ProcessTargetInfo: the server's pairs without its target name and
    /// channel bindings, then the SPN (9), zero channel bindings (10), the
    /// MIC flag (6) and the end. The CONNECT conn carries no
    /// TransportContext, so the bindings are zero even to an https proxy.
    /// A dropped pair leaves the buffer longer than what was written, and
    /// then .NET returns its tail (AsSpan(offset)), which is kept.
    fn target_info(&self, info: &[u8]) -> Result<(Vec<u8>, u64, bool), Throw> {
        let spn = utf16le(&self.spn);
        if spn.len() > 32767 {
            return Err(Throw);
        }
        let mut out = vec![0u8; info.len() + 20 + 4 + spn.len() + 8];
        let mut at = 0;
        let mut stamp = file_time_now();
        let (mut nb_computer, mut nb_domain) = (false, false);
        let mut rest = info;
        while rest.len() >= 4 {
            let id = rest[0];
            let length = (usize::from(rest[3]) << 8) + usize::from(rest[2]);
            if id == 0 {
                break;
            }
            if rest.len() < length + 4 || id == 7 && rest.len() < 12 {
                return Err(Throw);
            }
            match id {
                7 => {
                    // Eight bytes, whatever the pair's length says.
                    let mut value = [0u8; 8];
                    value.copy_from_slice(&rest[4..12]);
                    let value = i64::from_le_bytes(value);
                    // DateTime.FromFileTimeUtc's range.
                    if !(0..=2_650_467_743_999_999_999).contains(&value) {
                        return Err(Throw);
                    }
                    stamp = value as u64;
                }
                9 | 10 => {
                    rest = &rest[length + 4..];
                    continue;
                }
                1 => nb_computer = true,
                2 => nb_domain = true,
                _ => {}
            }
            out[at..at + length + 4].copy_from_slice(&rest[..length + 4]);
            at += length + 4;
            rest = &rest[length + 4..];
        }
        out[at] = 9;
        out[at + 2..at + 4].copy_from_slice(&(spn.len() as u16).to_le_bytes());
        out[at + 4..at + 4 + spn.len()].copy_from_slice(&spn);
        at += 4 + spn.len();
        out[at] = 10;
        out[at + 2] = 16;
        at += 20;
        out[at] = 6;
        out[at + 2] = 4;
        out[at + 4] = 2;
        at += 8 + 4;
        let names = nb_computer && nb_domain;
        match at.cmp(&out.len()) {
            std::cmp::Ordering::Equal => Ok((out, stamp, names)),
            // No end pair in the server's list: AsSpan past the buffer.
            std::cmp::Ordering::Greater => Err(Throw),
            std::cmp::Ordering::Less => Ok((out[at..].to_vec(), stamp, names)),
        }
    }
}

/// GetField: the length and offset read as Int16, empty when the field is
/// empty or runs past the message.
fn field(blob: &[u8], at: usize) -> Result<&[u8], Throw> {
    let length = i32::from(i16::from_le_bytes([blob[at], blob[at + 1]]));
    let offset = i32::from(i16::from_le_bytes([blob[at + 4], blob[at + 5]]));
    if length == 0 || offset + length > blob.len() as i32 {
        return Ok(&[]);
    }
    if offset < 0 || length < 0 {
        return Err(Throw);
    }
    Ok(&blob[offset as usize..(offset + length) as usize])
}

/// NegotiateAuthenticationStatusCode values the handshake tells apart:
/// anything past Continue is a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Status {
    Completed,
    Continue,
    GenericFailure,
    Unsupported,
    MessageAltered,
    InvalidToken,
    UnknownCredentials,
}

/// NegState values of a NegTokenResp; -1 is a NegTokenResp without one.
const NEG_ACCEPT_COMPLETED: i64 = 0;
const NEG_ACCEPT_INCOMPLETE: i64 = 1;
const NEG_REJECT: i64 = 2;
const NEG_REQUEST_MIC: i64 = 3;

struct NegTokenResp {
    neg_state: i64,
    mech: Option<Vec<u8>>,
    token: Vec<u8>,
    mic: Option<Vec<u8>>,
}

/// [1] { SEQ { [0] negState, [1] supportedMech, [2] responseToken,
/// [3] mechListMIC } } as AsnValueReader reads it under DER: each part
/// optional and in order, ENUMERATED and OID strict. What follows the SEQ
/// inside [1] is never read.
fn read_neg_token_resp(data: &[u8]) -> Option<NegTokenResp> {
    let (outer, rest) = der_read(data, 0xa1)?;
    if !rest.is_empty() {
        return None;
    }
    let (mut fields, _) = der_read(outer, 0x30)?;
    let mut resp = NegTokenResp {
        neg_state: -1,
        mech: None,
        token: Vec::new(),
        mic: None,
    };
    for (i, (tag, inner_tag)) in [(0xa0, 0x0a), (0xa1, 0x06), (0xa2, 0x04), (0xa3, 0x04)]
        .into_iter()
        .enumerate()
    {
        if fields.first() != Some(&tag) {
            continue;
        }
        let (inner, after) = der_read(fields, tag)?;
        fields = after;
        let (value, rest) = der_read(inner, inner_tag)?;
        if !rest.is_empty() {
            return None;
        }
        match i {
            0 => resp.neg_state = der_int32(value)?,
            1 => {
                if !der_oid(value) {
                    return None;
                }
                resp.mech = Some(value.to_vec());
            }
            2 => resp.token = value.to_vec(),
            _ => resp.mic = Some(value.to_vec()),
        }
    }
    fields.is_empty().then_some(resp)
}

/// ReadEnumeratedValue for an int enum: minimal two's complement, at most
/// four bytes.
fn der_int32(value: &[u8]) -> Option<i64> {
    if value.is_empty() || value.len() > 4 {
        return None;
    }
    if value.len() > 1
        && (value[0] == 0 && value[1] & 0x80 == 0 || value[0] == 0xff && value[1] & 0x80 != 0)
    {
        return None;
    }
    let mut n = i64::from(value[0] as i8);
    for &b in &value[1..] {
        n = n << 8 | i64::from(b);
    }
    Some(n)
}

/// ReadObjectIdentifier's check: no empty content, no padded
/// sub-identifier, and the last one ends.
fn der_oid(value: &[u8]) -> bool {
    let Some(last) = value.last() else {
        return false;
    };
    if last & 0x80 != 0 {
        return false;
    }
    let mut start = true;
    for &b in value {
        if start && b == 0x80 {
            return false;
        }
        start = b & 0x80 == 0;
    }
    true
}

/// GetMIC (CalculateSignature) with the client signing key and a fresh
/// client sealing RC4.
pub(crate) fn signature(exported: &[u8], sequence: u32, message: &[u8]) -> [u8; 16] {
    signature_with(exported, SIGN_MAGIC, SEAL_MAGIC, sequence, message)
}

/// CalculateSignature with the keys the magics derive and a fresh RC4
/// from the sealing key.
fn signature_with(
    exported: &[u8],
    signing: &[u8],
    sealing: &[u8],
    sequence: u32,
    message: &[u8],
) -> [u8; 16] {
    let sign_key = md5(&[exported, signing].concat());
    let seal_key = md5(&[exported, sealing].concat());
    let mut out = [0u8; 16];
    out[..4].copy_from_slice(&1u32.to_le_bytes());
    out[12..].copy_from_slice(&sequence.to_le_bytes());
    let checksum = hmac_md5_parts(&sign_key, &[&out[12..], message]);
    out[4..12].copy_from_slice(&rc4(&seal_key, &checksum[..8]));
    out
}

/// makeNtlm2ChallengeResponse: NTProofStr, then the blob (versions 1 and
/// 1, the time, the client challenge, the target info and four zero bytes).
pub(crate) fn nt_response(
    hash: &[u8],
    server_challenge: &[u8],
    client_challenge: &[u8],
    stamp: u64,
    info: &[u8],
) -> Vec<u8> {
    let mut response = vec![0u8; 48 + info.len()];
    response[16] = 1;
    response[17] = 1;
    response[24..32].copy_from_slice(&stamp.to_le_bytes());
    response[32..40].copy_from_slice(client_challenge);
    response[44..44 + info.len()].copy_from_slice(info);
    let proof = hmac_md5_parts(hash, &[server_challenge, &response[16..]]);
    response[..16].copy_from_slice(&proof);
    response
}

/// makeNtlm2Hash: HMAC-MD5 keyed by MD4 of the password, over the
/// upper-cased user and the domain as is.
pub(crate) fn ntowfv2(user: &str, domain: &str, password: &str) -> Result<[u8; 16], Throw> {
    if password.encode_utf16().count() > 128 {
        return Err(Throw);
    }
    let upper: String = user.chars().map(blok_dotnet::to_upper_invariant).collect();
    Ok(hmac_md5(
        &md4(&utf16le(password)),
        &utf16le(&format!("{upper}{domain}")),
    ))
}

pub(crate) fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(u16::to_le_bytes).collect()
}

/// DateTime.UtcNow.ToFileTimeUtc: 100 ns ticks since 1601.
fn file_time_now() -> u64 {
    const EPOCH: u64 = 116_444_736_000_000_000;
    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    EPOCH + (since.as_nanos() / 100) as u64
}

/// Environment.MachineName (System.Private.CoreLib 10.0.11, decompiled):
/// on Unix gethostname up to its first dot, case kept. Windows .NET asks
/// GetComputerName, which COMPUTERNAME carries.
pub(crate) fn machine_name() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME").unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        let name = gethostname::gethostname().to_string_lossy().into_owned();
        name.split('.').next().unwrap_or_default().to_owned()
    }
}

/// HMAC (RFC 2104) with MD5.
pub(crate) fn hmac_md5_parts(key: &[u8], parts: &[&[u8]]) -> [u8; 16] {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        block[..16].copy_from_slice(&md5(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner: Vec<u8> = block.iter().map(|b| b ^ 0x36).collect();
    for part in parts {
        inner.extend_from_slice(part);
    }
    let mut outer: Vec<u8> = block.iter().map(|b| b ^ 0x5c).collect();
    outer.extend_from_slice(&md5(&inner));
    md5(&outer)
}

pub(crate) fn hmac_md5(key: &[u8], data: &[u8]) -> [u8; 16] {
    hmac_md5_parts(key, &[data])
}

/// RC4 from the start of its keystream.
pub(crate) fn rc4(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut s: Vec<u8> = (0..=255).collect();
    let mut j = 0u8;
    for i in 0..256 {
        j = j.wrapping_add(s[i]).wrapping_add(key[i % key.len()]);
        s.swap(i, usize::from(j));
    }
    let (mut i, mut j) = (0u8, 0u8);
    data.iter()
        .map(|&b| {
            i = i.wrapping_add(1);
            j = j.wrapping_add(s[usize::from(i)]);
            s.swap(usize::from(i), usize::from(j));
            b ^ s[usize::from(s[usize::from(i)].wrapping_add(s[usize::from(j)]))]
        })
        .collect()
}

/// MD4 (RFC 1320).
pub(crate) fn md4(input: &[u8]) -> [u8; 16] {
    let mut message = vec![0u8; (input.len() + 8) / 64 * 64 + 64];
    message[..input.len()].copy_from_slice(input);
    message[input.len()] = 0x80;
    let bits = (input.len() as u64).wrapping_mul(8);
    let end = message.len();
    message[end - 8..].copy_from_slice(&bits.to_le_bytes());
    let (mut a, mut b, mut c, mut d) = (
        0x6745_2301u32,
        0xefcd_ab89u32,
        0x98ba_dcfeu32,
        0x1032_5476u32,
    );
    const ORDER: [usize; 16] = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for block in message.chunks(64) {
        let x: Vec<u32> = block
            .chunks(4)
            .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
            .collect();
        let (aa, bb, cc, dd) = (a, b, c, d);
        for i in 0..16 {
            let t = a
                .wrapping_add((b & c) | (!b & d))
                .wrapping_add(x[i])
                .rotate_left([3, 7, 11, 19][i % 4]);
            (a, b, c, d) = (d, t, b, c);
        }
        for i in 0..16 {
            let t = a
                .wrapping_add((b & c) | (b & d) | (c & d))
                .wrapping_add(x[i % 4 * 4 + i / 4])
                .wrapping_add(0x5a82_7999)
                .rotate_left([3, 5, 9, 13][i % 4]);
            (a, b, c, d) = (d, t, b, c);
        }
        for i in 0..16 {
            let t = a
                .wrapping_add(b ^ c ^ d)
                .wrapping_add(x[ORDER[i]])
                .wrapping_add(0x6ed9_eba1)
                .rotate_left([3, 9, 11, 15][i % 4]);
            (a, b, c, d) = (d, t, b, c);
        }
        a = a.wrapping_add(aa);
        b = b.wrapping_add(bb);
        c = c.wrapping_add(cc);
        d = d.wrapping_add(dd);
    }
    let mut out = [0u8; 16];
    for (i, word) in [a, b, c, d].iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    out
}

/// One DER element: tag, the shortest length, then the content.
fn der(tag: u8, content: &[&[u8]]) -> Vec<u8> {
    let body = content.concat();
    let n = body.len();
    let mut out = vec![tag];
    if n < 0x80 {
        out.push(n as u8);
    } else if n < 0x100 {
        out.extend_from_slice(&[0x81, n as u8]);
    } else if n < 0x10000 {
        out.extend_from_slice(&[0x82, (n >> 8) as u8, n as u8]);
    } else {
        out.extend_from_slice(&[0x83, (n >> 16) as u8, (n >> 8) as u8, n as u8]);
    }
    out.extend_from_slice(&body);
    out
}

/// One element with this tag in strict DER: its content and what follows.
fn der_read(data: &[u8], tag: u8) -> Option<(&[u8], &[u8])> {
    if data.len() < 2 || data[0] != tag {
        return None;
    }
    let (mut length, mut at) = (usize::from(data[1]), 2);
    if length >= 0x80 {
        let count = length - 0x80;
        if count == 0 || count > 3 || data.len() < 2 + count || data[2] == 0 {
            return None;
        }
        length = data[2..2 + count]
            .iter()
            .fold(0, |n, &b| n << 8 | usize::from(b));
        if length < 0x80 {
            return None;
        }
        at += count;
    }
    if data.len() - at < length {
        return None;
    }
    Some((&data[at..at + length], &data[at + length..]))
}
