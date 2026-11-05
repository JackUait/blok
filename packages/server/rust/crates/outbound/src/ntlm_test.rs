use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::digest::md5;
use crate::ntlm::{
    SEAL_MAGIC, SIGN_MAGIC, hmac_md5, hmac_md5_parts, md4, nt_response, ntowfv2, rc4, signature,
    utf16le,
};
use crate::operator::{OperatorClient, OperatorError, Request, RequestBody};
use crate::origin_test::{Origin, ok_handler};
use crate::pki_test::{acceptor, pki};
use crate::proxy::EnvironmentProxy;
use crate::wire::Source;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn md4_matches_rfc_1320() {
    for (input, want) in [
        ("", "31d6cfe0d16ae931b73c59d7e0c089c0"),
        ("a", "bde52cb31de33e46245e05fbdbd6fb24"),
        ("abc", "a448017aaf21d8525fc10ae87aa6729d"),
        (
            "abcdefghijklmnopqrstuvwxyz",
            "d79e1c308aa5bbcdeea8ed63df412da9",
        ),
        (
            "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
            "e33b4ddc9c38f2199c3e7b164fcc0536",
        ),
    ] {
        assert_eq!(hex(&md4(input.as_bytes())), want, "{input}");
    }
}

#[test]
fn hmac_md5_matches_rfc_2202() {
    assert_eq!(
        hex(&hmac_md5(&[0x0b; 16], b"Hi There")),
        "9294727a3638bb1c13f48ef8158bfc9d"
    );
    assert_eq!(
        hex(&hmac_md5(b"Jefe", b"what do ya want for nothing?")),
        "750c783e6ab0b503eaa86e310a5db738"
    );
    // A key longer than the block is hashed first.
    assert_eq!(
        hex(&hmac_md5(
            &[0xaa; 80],
            b"Test Using Larger Than Block-Size Key - Hash Key First"
        )),
        "6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd"
    );
}

#[test]
fn rc4_matches_rfc_6229() {
    let stream = rc4(&from_hex("0102030405"), &[0u8; 32]);
    assert_eq!(
        hex(&stream),
        "b2396305f03dc027ccc3524a0a1118a86982944f18fc82d589c403a47a0d0919"
    );
}

// MS-NLMP 4.2.4: User, Domain, Password, server challenge 0123456789abcdef,
// client challenge aa x 8, time 0, random session key 55 x 16.
#[test]
fn ntlm_matches_the_ms_nlmp_ntlmv2_vectors() {
    let hash = ntowfv2("User", "Domain", "Password").unwrap();
    assert_eq!(hex(&hash), "0c868a403bfd7a93a3001ef22ef02e3f");
    let info = from_hex("02000c0044006f006d00610069006e0001000c0053006500720076006500720000000000");
    let response = nt_response(&hash, &from_hex("0123456789abcdef"), &[0xaa; 8], 0, &info);
    assert_eq!(
        hex(&response),
        "68cd0ab851e51c96aabc927bebef6a1c01010000000000000000000000000000aaaaaaaaaaaaaaaa0000000002000c0044006f006d00610069006e0001000c005300650072007600650072000000000000000000"
    );
    let base = hmac_md5(&hash, &response[..16]);
    assert_eq!(hex(&base), "8de40ccadbc14a82f15cb0ad0de95ca3");
    let exported = [0x55u8; 16];
    assert_eq!(
        hex(&rc4(&base, &exported)),
        "c5dad2544fc9799094ce1ce90bc9d03e"
    );
    // 4.2.4.4: the seal RC4 runs over the 18 plaintext bytes first, so the
    // checksum sits at keystream offset 18.
    let seal_key = md5(&[&exported[..], SEAL_MAGIC].concat());
    let sign_key = md5(&[&exported[..], SIGN_MAGIC].concat());
    assert_eq!(hex(&seal_key), "59f600973cc4960a25480a7c196e4c58");
    assert_eq!(hex(&sign_key), "4788dc861b4782f35d43fd98fe1a2d39");
    let plaintext = utf16le("Plaintext");
    let checksum = hmac_md5_parts(&sign_key, &[&[0, 0, 0, 0], &plaintext]);
    let stream = rc4(&seal_key, &[&plaintext[..], &checksum[..8]].concat());
    assert_eq!(
        hex(&stream),
        "54e50165bf1936dc996020c1811b0f06fb5f7fb38ec5c55d4976"
    );
    // GetMIC is the same checksum on a fresh RC4.
    let want = format!("01000000{}00000000", hex(&rc4(&seal_key, &checksum[..8])));
    assert_eq!(hex(&signature(&exported, 0, &plaintext)), want);
}

// The verifying proxy of C#'s AnswersAnNtlmChallengeAsSocketsHttpHandlerDoes.
const SERVER_CHALLENGE: [u8; 8] = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
const FIXED_TIME: [u8; 8] = [0x00, 0x80, 0x3e, 0xd5, 0xde, 0xb1, 0x9d, 0x01];
const TYPE1: &str =
    "4e544c4d535350000100000015828862000000000000000000000000000000000601b01d0000000f";
const SPNEGO_INIT: &str = "604806062b0601050502a03e303ca00e300c060a2b06010401823702020aa22a04284e544c4d535350000100000015828862000000000000000000000000000000000601b01d0000000f";
const SERVER_AVS: &str = "2:44004f004d00410049004e00,1:530045005200560045005200,4:64006f006d00610069006e002e007400650073007400,3:7300650072007600650072002e0064006f006d00610069006e002e007400650073007400,7:00803ed5deb19d01,";

fn av(id: u16, value: &[u8]) -> Vec<u8> {
    let mut pair = id.to_le_bytes().to_vec();
    pair.extend_from_slice(&(value.len() as u16).to_le_bytes());
    pair.extend_from_slice(value);
    pair
}

fn from_utf16(b: &[u8]) -> String {
    let units: Vec<u16> = b
        .chunks(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

fn type2(mode: &str) -> Vec<u8> {
    let mut info = av(2, &utf16le("DOMAIN"));
    if mode != "no-nb" {
        info.extend(av(1, &utf16le("SERVER")));
    }
    info.extend(av(4, &utf16le("domain.test")));
    info.extend(av(3, &utf16le("server.domain.test")));
    info.extend(av(7, &FIXED_TIME));
    if mode == "av9" {
        info.extend(av(9, &utf16le("HTTP/x")));
    }
    info.extend([0, 0, 0, 0]);
    let name = utf16le("DOMAIN");
    let mut message = vec![0u8; 56];
    message[..8].copy_from_slice(b"NTLMSSP\0");
    message[8] = 2;
    message[12..14].copy_from_slice(&(name.len() as u16).to_le_bytes());
    message[14..16].copy_from_slice(&(name.len() as u16).to_le_bytes());
    message[16..20].copy_from_slice(&56u32.to_le_bytes());
    let mut flags = 0x6289_8215u32;
    if mode == "flags" {
        flags &= !0x4000_0000;
    }
    message[20..24].copy_from_slice(&flags.to_le_bytes());
    message[24..32].copy_from_slice(&SERVER_CHALLENGE);
    message[40..42].copy_from_slice(&(info.len() as u16).to_le_bytes());
    message[42..44].copy_from_slice(&(info.len() as u16).to_le_bytes());
    message[44..48].copy_from_slice(&((56 + name.len()) as u32).to_le_bytes());
    message[48..56].copy_from_slice(&[0x0a, 0x00, 0x63, 0x45, 0, 0, 0, 0x0f]);
    message.extend(name);
    message.extend(info);
    message
}

/// One DER element: tag, content, the rest.
fn der(data: &[u8]) -> (u8, &[u8], &[u8]) {
    let (tag, mut length, mut at) = (data[0], usize::from(data[1]), 2);
    if length > 0x80 {
        let count = length - 0x80;
        length = data[2..2 + count]
            .iter()
            .fold(0, |n, &b| n << 8 | usize::from(b));
        at += count;
    }
    (tag, &data[at..at + length], &data[at + length..])
}

fn der_wrap(tag: u8, content: &[u8]) -> Vec<u8> {
    let n = content.len();
    let mut out = vec![tag];
    if n < 0x80 {
        out.push(n as u8);
    } else if n < 0x100 {
        out.extend([0x81, n as u8]);
    } else {
        out.extend([0x82, (n >> 8) as u8, n as u8]);
    }
    out.extend_from_slice(content);
    out
}

fn spnego_challenge(type2: &[u8]) -> Vec<u8> {
    let mut seq = der_wrap(0xa0, &[0x0a, 0x01, 0x01]);
    seq.extend(der_wrap(0xa1, &from_hex("060a2b06010401823702020a")));
    seq.extend(der_wrap(0xa2, &der_wrap(0x04, type2)));
    der_wrap(0xa1, &der_wrap(0x30, &seq))
}

#[derive(Default)]
struct State {
    type1: Option<Vec<u8>>,
    type2: Option<Vec<u8>>,
    mech_list: Vec<u8>,
}

fn text_field(m: &[u8], at: usize) -> (String, usize, usize) {
    let length = usize::from(u16::from_le_bytes([m[at], m[at + 1]]));
    let offset = u32::from_le_bytes([m[at + 4], m[at + 5], m[at + 6], m[at + 7]]) as usize;
    if offset + length > m.len() {
        return ("?".into(), length, offset);
    }
    (from_utf16(&m[offset..offset + length]), length, offset)
}

fn zero(b: &[u8]) -> bool {
    b.iter().all(|&x| x == 0)
}

/// C#'s ReadNtlm. `upper` is the user as ToUpperInvariant gives it, from
/// C#'s NtlmUpperCasesTheUserAsToUpperInvariant.
fn read_ntlm(scheme: &str, token: &[u8], state: &mut State, password: &str) -> (String, bool) {
    let upper: HashMap<&str, &str> = [("u", "U"), ("ß", "ß"), ("ıſ", "ıS")].into();
    let (mut inner, mut spnego, mut mech_list_mic) = (token, String::new(), None);
    if scheme == "Negotiate" {
        if token[0] == 0x60 {
            let (_, app, _) = der(token);
            let (_, _, rest) = der(app);
            let (_, a0, _) = der(rest);
            let (_, init, _) = der(a0);
            let (_, mech_types, rest) = der(init);
            let (tag, list, _) = der(mech_types);
            state.mech_list = der_wrap(tag, list);
            let (_, a2, _) = der(rest);
            inner = der(a2).1;
            spnego = format!("init {} mechs={} ", hex(token), hex(&state.mech_list));
        } else {
            let (_, a1, _) = der(token);
            let (_, resp, _) = der(a1);
            let (tag, first, rest) = der(resp);
            inner = der(first).1;
            let mut tags = format!("{:02x}/{:02x}/{tag:02x}:{:02x}", token[0], a1[0], first[0]);
            if !rest.is_empty() {
                let (tag, second, _) = der(rest);
                mech_list_mic = Some(der(second).1.to_vec());
                tags += &format!(",{tag:02x}:{:02x}", second[0]);
            }
            spnego = format!("resp {tags} ");
        }
    }
    if inner[8] == 1 {
        state.type1 = Some(inner.to_vec());
        return (format!("{scheme} {spnego}T1 {}", hex(inner)), false);
    }
    let t3 = inner;
    let (_, lm_len, lm_off) = text_field(t3, 12);
    let (_, nt_len, nt_off) = text_field(t3, 20);
    let (dom, _, dom_off) = text_field(t3, 28);
    let (user, _, user_off) = text_field(t3, 36);
    let (ws, ws_len, ws_off) = text_field(t3, 44);
    let (_, key_len, key_off) = text_field(t3, 52);
    let flags = u32::from_le_bytes([t3[60], t3[61], t3[62], t3[63]]);
    let response = &t3[nt_off..nt_off + nt_len];
    let blob = &response[16..];
    let up = upper.get(user.as_str()).copied().unwrap_or(&user);
    let ntowf = hmac_md5(&md4(&utf16le(password)), &utf16le(&format!("{up}{dom}")));
    let proof = hmac_md5_parts(&ntowf, &[&SERVER_CHALLENGE, blob]);
    let proof_ok = proof[..] == response[..16];
    let exported = rc4(&hmac_md5(&ntowf, &proof), &t3[key_off..key_off + key_len]);
    let mut zeroed = t3.to_vec();
    zeroed[72..88].fill(0);
    let mic = hmac_md5_parts(
        &exported,
        &[
            state.type1.as_deref().unwrap(),
            state.type2.as_deref().unwrap(),
            &zeroed,
        ],
    );
    let mic_ok = mic[..] == t3[72..88];
    let (mut avs, mut cbt_ok, mut at) = (Vec::new(), true, 28);
    while at + 4 <= blob.len() {
        let id = u16::from_le_bytes([blob[at], blob[at + 1]]);
        let length = usize::from(u16::from_le_bytes([blob[at + 2], blob[at + 3]]));
        let value = &blob[at + 4..at + 4 + length.min(blob.len() - at - 4)];
        match id {
            10 => {
                cbt_ok = value.len() == 16 && zero(value);
                avs.push(if cbt_ok {
                    "10:zero".to_owned()
                } else {
                    format!("10:{}", hex(value))
                });
            }
            9 => avs.push(format!("9:{}", from_utf16(value))),
            _ => avs.push(format!("{id}:{}", hex(value))),
        }
        at += 4 + length;
        if id == 0 {
            break;
        }
    }
    let (mut mlmic, mut mlmic_ok) = (String::new(), true);
    if scheme == "Negotiate" {
        let sign_key = md5(&[
            &exported[..],
            b"session key to client-to-server signing key magic constant\0",
        ]
        .concat());
        let seal_key = md5(&[
            &exported[..],
            b"session key to client-to-server sealing key magic constant\0",
        ]
        .concat());
        let checksum = hmac_md5_parts(&sign_key, &[&[0, 0, 0, 0], &state.mech_list]);
        let want = [
            &[1, 0, 0, 0][..],
            &rc4(&seal_key, &checksum[..8]),
            &[0, 0, 0, 0],
        ]
        .concat();
        mlmic_ok = mech_list_mic.as_deref() == Some(&want[..]);
        mlmic = match (&mech_list_mic, mlmic_ok) {
            (None, _) => " mlmic=none",
            (_, true) => " mlmic=ok",
            _ => " mlmic=bad",
        }
        .to_owned();
    }
    // C# names the host up to its first dot (Environment.MachineName).
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let ws = if !ws.is_empty() && ws == host.split('.').next().unwrap_or_default() {
        "W".to_owned()
    } else {
        ws
    };
    let word = |ok: bool| if ok { "ok" } else { "bad" };
    let logged = format!(
        "{scheme} {spnego}T3 len={} flags={flags:08x} ver={} lm={lm_len}@{lm_off}{} nt={nt_len}@{nt_off} user={user}@{user_off} dom={dom}@{dom_off} ws={ws}@{ws_off} key={key_len}@ws+{} head={} cc={} avs={} proof={} mic={}{mlmic}",
        t3.len() - ws_len,
        hex(&t3[64..72]),
        if zero(&t3[lm_off..lm_off + lm_len]) {
            ":0"
        } else {
            ":x"
        },
        key_off - ws_off - ws_len,
        hex(&blob[..16]),
        if zero(&blob[24..28]) { "CC" } else { "?" },
        avs.join(","),
        word(proof_ok),
        word(mic_ok),
    );
    (logged, proof_ok && mic_ok && cbt_ok && mlmic_ok)
}

/// C#'s DrainShape: the version and what follows the challenge in a drain
/// row's first 407 (drain1-) or Type 2 (drain2-).
fn drain_shape(mode: &str, first: bool) -> (&'static str, String) {
    let prefix = if first { "drain1-" } else { "drain2-" };
    let Some(shape) = mode.strip_prefix(prefix) else {
        return ("1.1", "Content-Length: 0\r\n\r\n".to_owned());
    };
    let big = "a".repeat(2097152);
    match shape {
        "ka0" => (
            "1.1",
            "Keep-Alive: max=0\r\nContent-Length: 0\r\n\r\n".to_owned(),
        ),
        "extra" => ("1.1", "Content-Length: 0\r\n\r\nxyz".to_owned()),
        "big" => ("1.1", format!("Content-Length: 2097152\r\n\r\n{big}")),
        "bigchunked" => (
            "1.1",
            format!("Transfer-Encoding: chunked\r\n\r\n200000\r\n{big}\r\n0\r\n\r\n"),
        ),
        "http10" => ("1.0", "Content-Length: 0\r\n\r\n".to_owned()),
        "body" => ("1.1", "Content-Length: 3\r\n\r\nabc".to_owned()),
        "chunked" => (
            "1.1",
            "Transfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n".to_owned(),
        ),
        "closeframed" => ("1.1", "\r\nabc".to_owned()),
        "stall" => ("1.1", "Content-Length: 10\r\n\r\nabc".to_owned()),
        _ => panic!("{mode}"),
    }
}

async fn serve_ntlm<S: AsyncRead + AsyncWrite + Unpin>(
    stream: S,
    id: usize,
    mode: &str,
    password: &str,
    log: &Mutex<Vec<String>>,
) {
    let scheme = if mode.starts_with("negotiate") {
        "Negotiate"
    } else {
        "NTLM"
    };
    let mut reader = BufReader::new(stream);
    let mut state = State::default();
    for _ in 0..4 {
        let (mut first, mut auth) = (String::new(), None);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                return;
            }
            let line = line.trim_end().to_owned();
            if line.is_empty() {
                break;
            }
            if first.is_empty() {
                first = line.clone();
            }
            if let Some(value) = line.strip_prefix("Proxy-Authorization:") {
                auth = Some(value.trim().to_owned());
            }
        }
        let (mut answer, mut closing) = (String::new(), false);
        let first_407 = auth.is_none();
        match auth {
            None => {
                log.lock().unwrap().push(format!("{id} auth=no"));
                closing = mode == "close1";
                answer = format!("Proxy-Authenticate: {scheme}\r\n");
            }
            Some(auth) => {
                let (name, data) = auth.split_once(' ').unwrap();
                let token = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .unwrap();
                let (logged, valid) = read_ntlm(name, &token, &mut state, password);
                log.lock().unwrap().push(format!("{id} auth={logged}"));
                if valid {
                    let target = first.split(' ').nth(1).unwrap().to_owned();
                    let mut upstream = TcpStream::connect(target).await.unwrap();
                    let mut stream = reader.into_inner();
                    stream
                        .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                        .await
                        .unwrap();
                    let _ = tokio::io::copy_bidirectional(&mut stream, &mut upstream).await;
                    return;
                }
                if state.type1.is_some() && state.type2.is_none() {
                    let message = type2(mode);
                    closing = mode == "close2";
                    let challenge = match mode {
                        "bare" | "negotiate-bare" => String::new(),
                        "short" => format!(
                            " {}",
                            base64::engine::general_purpose::STANDARD.encode(&message[..10])
                        ),
                        "base64" => " !!!".to_owned(),
                        _ => {
                            let token = if scheme == "Negotiate" {
                                spnego_challenge(&message)
                            } else {
                                message.clone()
                            };
                            format!(
                                " {}",
                                base64::engine::general_purpose::STANDARD.encode(token)
                            )
                        }
                    };
                    state.type2 = Some(message);
                    answer = format!("Proxy-Authenticate: {scheme}{challenge}\r\n");
                }
            }
        }
        if closing {
            answer += "Connection: close\r\n";
        }
        let (version, tail) = drain_shape(mode, first_407);
        let head = format!("HTTP/{version} 407 Proxy Authentication Required\r\n{answer}{tail}");
        if reader.get_mut().write_all(head.as_bytes()).await.is_err() || closing {
            return;
        }
    }
}

/// C#'s outcome as the twins can see it: a status from the tunnel, or an
/// error without one (.NET throws or has none).
fn twin_outcome(want: &str) -> String {
    let (outcome, rest) = want
        .split_once('|')
        .map_or((want, None), |(o, r)| (o, Some(r)));
    let outcome = if outcome.starts_with("throw ") || outcome == "error " {
        "error"
    } else {
        outcome
    };
    match rest {
        Some(rest) => format!("{outcome}|{rest}"),
        None => outcome.to_owned(),
    }
}

// The twin of C#'s AnswersAnNtlmChallengeAsSocketsHttpHandlerDoes: the
// same rows, the same verifier.
#[tokio::test]
async fn answers_an_ntlm_challenge_as_sockets_http_handler_does() {
    let pki = pki("localhost", |fields| fields.names.push("127.0.0.1".into()));
    let target = Origin::start(
        "127.0.0.1:0",
        Some(acceptor(pki.chain.clone(), pki.key.clone_key(), &[])),
        ok_handler(),
    )
    .await
    .unwrap();
    for (mode, user, domain, password, want) in [
        (
            "ntlm",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "negotiate",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}|1 auth=Negotiate resp a1/30/a2:04,a3:04 T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok mlmic=ok",
        ),
        (
            "domain",
            "u",
            "DOM",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=358 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=DOM@336 ws=W@342 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        ("empty", "u", "", "", "error 407|1 auth=no"),
        (
            "sharp",
            "ß",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=ß@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "dotless",
            "ıſ",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=354 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=ıſ@334 dom=@338 ws=W@338 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "flags",
            "u",
            "",
            "p",
            "error 407|1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "no-nb",
            "u",
            "",
            "p",
            "error 407|1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "negotiate-bare",
            "u",
            "",
            "p",
            "error 407|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}",
        ),
        (
            "bare",
            "u",
            "",
            "p",
            "throw ArgumentOutOfRangeException|1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "av9",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=194 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=64@112 user=u@176 dom=@178 ws=W@178 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs=0: proof=ok mic=ok",
        ),
        (
            "close1",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|2 auth=NTLM T1 {T1}|2 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "close2",
            "u",
            "",
            "p",
            "error |1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "short",
            "u",
            "",
            "p",
            "throw ArgumentOutOfRangeException|1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "base64",
            "u",
            "",
            "p",
            "throw FormatException|1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "https",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "localhost",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/localhost,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "upper",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/localhost,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "ipv6",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=340 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=210@112 user=u@322 dom=@324 ws=W@324 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/::1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "negotiate-https",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=Negotiate init {INIT} mechs=300c060a2b06010401823702020a T1 {T1}|1 auth=Negotiate resp a1/30/a2:04,a3:04 T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok mlmic=ok",
        ),
        (
            "drain1-http10",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        ("drain1-extra", "u", "", "p", "error |1 auth=no"),
        (
            "drain2-ka0",
            "u",
            "",
            "p",
            "error |1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "drain2-closeframed",
            "u",
            "",
            "p",
            "error |1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        ("drain1-ka0", "u", "", "p", "error |1 auth=no"),
        (
            "drain2-http10",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        (
            "drain2-bigchunked",
            "u",
            "",
            "p",
            "error |1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "drain2-extra",
            "u",
            "",
            "p",
            "error |1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "drain2-stall",
            "u",
            "",
            "p",
            "throw IOException|1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        (
            "drain2-big",
            "u",
            "",
            "p",
            "error |1 auth=no|1 auth=NTLM T1 {T1}",
        ),
        ("drain1-closeframed", "u", "", "p", "error |1 auth=no"),
        (
            "drain2-chunked",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
        ("drain1-big", "u", "", "p", "error |1 auth=no"),
        (
            "drain1-body",
            "u",
            "",
            "p",
            "200 ok|1 auth=no|1 auth=NTLM T1 {T1}|1 auth=NTLM T3 len=352 flags=62888215 ver=0601b01d0000000f lm=24@88:0 nt=222@112 user=u@334 dom=@336 ws=W@336 key=16@ws+0 head=010100000000000000803ed5deb19d01 cc=CC avs={AVS}9:HTTP/127.0.0.1,10:zero,6:02000000,0: proof=ok mic=ok",
        ),
    ] {
        let listener = TcpListener::bind(if mode == "ipv6" {
            "[::1]:0"
        } else {
            "127.0.0.1:0"
        })
        .await
        .unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        let tls = mode
            .ends_with("https")
            .then(|| acceptor(pki.chain.clone(), pki.key.clone_key(), &[]));
        tokio::spawn(async move {
            let mut conns = 0;
            while let Ok((client, _)) = listener.accept().await {
                conns += 1;
                let (id, log, tls) = (conns, log.clone(), tls.clone());
                tokio::spawn(async move {
                    match tls {
                        Some(tls) => {
                            if let Ok(stream) = tls.accept(client).await {
                                serve_ntlm(stream, id, mode, password, &log).await;
                            }
                        }
                        None => serve_ntlm(client, id, mode, password, &log).await,
                    }
                });
            }
        });
        let host = match mode {
            "localhost" => "localhost",
            "upper" => "LOCALHOST",
            "ipv6" => "[::1]",
            _ => "127.0.0.1",
        };
        let scheme = if mode.ends_with("https") {
            "https"
        } else {
            "http"
        };
        let encode = |s: &str| -> String {
            s.bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() {
                        char::from(b).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect()
        };
        let name = if domain.is_empty() {
            user.to_owned()
        } else {
            format!("{domain}\\{user}")
        };
        let proxy_url = format!("{scheme}://{}:{password}@{host}:{port}", encode(&name));
        let client = OperatorClient {
            connect_timeout: Duration::from_secs(5),
            header_timeout: None,
            proxy: EnvironmentProxy::from_lookup(move |n| {
                (n == "ALL_PROXY").then(|| proxy_url.clone())
            }),
            roots: Some(pki.roots.clone()),
        };
        let url = blok_dotnet::parse_absolute_uri(&format!("https://localhost:{}/", target.port))
            .unwrap();
        let target_host = format!("localhost:{}", target.port);
        let outcome = match client
            .send(Request {
                method: "GET",
                url: &url,
                host: &target_host,
                headers: Vec::new(),
                body: RequestBody::None,
            })
            .await
        {
            Ok(mut response) => {
                let mut body = vec![0u8; 16];
                let n = response.body.read(&mut body).await.unwrap();
                format!(
                    "{} {}",
                    response.status,
                    String::from_utf8_lossy(&body[..n])
                )
            }
            Err(OperatorError::Tunnel(status)) => format!("error {status}"),
            Err(_) => "error".to_owned(),
        };
        let mut got = vec![outcome];
        got.extend(seen.lock().unwrap().iter().cloned());
        let want = twin_outcome(want)
            .replace("{T1}", TYPE1)
            .replace("{AVS}", SERVER_AVS)
            .replace("{INIT}", SPNEGO_INIT);
        assert_eq!(got.join("|"), want, "{mode}");
    }
}

// The twin of Go's TestNtlmSpnHostKeepsANameTheLookupCannotAnswer, with
// C#'s upper row: /etc/hosts spells localhost in lower case.
#[tokio::test]
async fn ntlm_spn_host_keeps_a_name_the_lookup_cannot_answer() {
    for (host, want) in [
        ("127.0.0.1", "127.0.0.1"),
        ("::1", "::1"),
        ("LOCALHOST", "localhost"),
        ("blok-ntlm-spn.invalid", "blok-ntlm-spn.invalid"),
    ] {
        assert_eq!(crate::operator::spn_host(host).await, want, "{host}");
    }
}
