//! The managed half of SslStream's check on macOS, after trustd built the
//! chain: CertificatePolicyChain.MatchesApplicationPolicies for serverAuth
//! and X509Certificate2.MatchesHostname (System.Security.Cryptography
//! 10.0.11). Go has the same in internal/sectrust/names.go.

use std::collections::HashSet;
use std::net::IpAddr;

/// The TrustResultDetails keys a .NET chain with revocation off does not
/// fail on: MergeStatusCodes (pal_x509chain.c) reports none of these, and
/// SecTrustChainPal.FixupStatus clears the two revocation ones under
/// X509RevocationMode.NoCheck.
pub(crate) const PASSING_DETAILS: [&str; 15] = [
    "UnparseableExtension",
    "WeakLeaf",
    "WeakIntermediates",
    "WeakRoot",
    "WeakKeySize",
    "WeakSignature",
    "StatusCodes",
    "NonEmptySubject",
    "GrayListedKey",
    "CTRequired",
    "GrayListedLeaf",
    "IdLinkage",
    "DuplicateExtension",
    "Revocation",
    "RevocationResponseRequired",
];

// OID contents, without tag and length.
const SERVER_AUTH: &[u8] = &[0x2b, 6, 1, 5, 5, 7, 3, 1];
const ANY_POLICY: &[u8] = &[0x55, 0x1d, 0x20, 0];
const APPLICATION_CERT_POLICIES: &[u8] = &[0x2b, 6, 1, 4, 1, 0x82, 0x37, 0x15, 0x0a];
const POLICY_CONSTRAINTS: &[u8] = &[0x55, 0x1d, 0x24];
const EXTENDED_KEY_USAGE: &[u8] = &[0x55, 0x1d, 0x25];
const SUBJECT_ALT_NAME: &[u8] = &[0x55, 0x1d, 0x11];
const COMMON_NAME: &[u8] = &[0x55, 4, 3];

/// One DER element: its tag and its content.
fn element<'a>(input: &mut &'a [u8]) -> Option<(u8, &'a [u8])> {
    let (&tag, rest) = input.split_first()?;
    let (&first, mut rest) = rest.split_first()?;
    let length = if first < 0x80 {
        usize::from(first)
    } else {
        let count = usize::from(first & 0x7f);
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        let (bytes, tail) = rest.split_at(count);
        rest = tail;
        bytes.iter().fold(0usize, |n, &b| (n << 8) | usize::from(b))
    };
    if rest.len() < length {
        return None;
    }
    let (content, tail) = rest.split_at(length);
    *input = tail;
    Some((tag, content))
}

fn expect<'a>(input: &mut &'a [u8], tag: u8) -> Option<&'a [u8]> {
    match element(input)? {
        (t, content) if t == tag => Some(content),
        _ => None,
    }
}

/// The parts of a certificate these checks read.
struct Parsed<'a> {
    subject: &'a [u8],
    extensions: Vec<(&'a [u8], &'a [u8])>,
}

fn parse(der: &[u8]) -> Option<Parsed<'_>> {
    let mut outer = der;
    let mut certificate = expect(&mut outer, 0x30)?;
    let mut tbs = expect(&mut certificate, 0x30)?;
    if tbs.first() == Some(&0xa0) {
        element(&mut tbs)?;
    }
    expect(&mut tbs, 0x02)?;
    expect(&mut tbs, 0x30)?;
    expect(&mut tbs, 0x30)?;
    expect(&mut tbs, 0x30)?;
    let subject = expect(&mut tbs, 0x30)?;
    expect(&mut tbs, 0x30)?;
    let mut extensions = Vec::new();
    while !tbs.is_empty() {
        let (tag, content) = element(&mut tbs)?;
        if tag != 0xa3 {
            continue;
        }
        let mut wrapped = content;
        let mut list = expect(&mut wrapped, 0x30)?;
        while !list.is_empty() {
            let mut extension = expect(&mut list, 0x30)?;
            let id = expect(&mut extension, 0x06)?;
            if extension.first() == Some(&0x01) {
                element(&mut extension)?;
            }
            extensions.push((id, expect(&mut extension, 0x04)?));
        }
    }
    Some(Parsed {
        subject,
        extensions,
    })
}

impl<'a> Parsed<'a> {
    fn extension(&self, id: &[u8]) -> Option<&'a [u8]> {
        self.extensions.iter().find(|(i, _)| *i == id).map(|e| e.1)
    }
}

struct ApplicationPolicy {
    declared: Option<HashSet<Vec<u8>>>,
    implicit_any: bool,
    specified_any: bool,
    require_explicit: Option<usize>,
}

fn oid_set(mut value: &[u8], wrapped: bool) -> Option<HashSet<Vec<u8>>> {
    let mut list = expect(&mut value, 0x30)?;
    if !value.is_empty() {
        return None;
    }
    let mut set = HashSet::new();
    while !list.is_empty() {
        let id = if wrapped {
            let mut information = expect(&mut list, 0x30)?;
            expect(&mut information, 0x06)?
        } else {
            expect(&mut list, 0x06)?
        };
        set.insert(id.to_vec());
    }
    Some(set)
}

fn read_application_policy(certificate: &Parsed<'_>) -> Option<ApplicationPolicy> {
    let mut require_explicit = None;
    if let Some(mut value) = certificate.extension(POLICY_CONSTRAINTS) {
        let mut constraints = expect(&mut value, 0x30)?;
        while !constraints.is_empty() {
            let (tag, content) = element(&mut constraints)?;
            if tag == 0x80 {
                require_explicit = Some(
                    content
                        .iter()
                        .fold(0usize, |n, &b| (n << 8) | usize::from(b)),
                );
            }
        }
    }
    let mut declared = match (
        certificate.extension(APPLICATION_CERT_POLICIES),
        certificate.extension(EXTENDED_KEY_USAGE),
    ) {
        (Some(value), _) => Some(oid_set(value, true)?),
        (None, Some(value)) => Some(oid_set(value, false)?),
        (None, None) => None,
    };
    let implicit_any = declared.is_none();
    let specified_any = declared.as_mut().is_some_and(|set| set.remove(ANY_POLICY));
    Some(ApplicationPolicy {
        declared,
        implicit_any,
        specified_any,
        require_explicit,
    })
}

/// CertificatePolicyChain.MatchesApplicationPolicies for serverAuth over
/// the built chain, leaf first. A decode error throws in .NET, which fails
/// the handshake.
pub(crate) fn server_auth_allowed(chain: &[Vec<u8>]) -> bool {
    let Some(mut policies) = chain
        .iter()
        .map(|der| parse(der).and_then(|c| read_application_policy(&c)))
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    // ReadPolicies: from the root down, requireExplicitPolicy ends the
    // implicit "any" of the certs below it.
    let mut restriction = policies.len();
    for policy in policies.iter_mut().rev() {
        if restriction == 0 {
            policy.implicit_any = false;
        } else {
            restriction -= 1;
        }
        if let Some(depth) = policy.require_explicit {
            restriction = restriction.min(depth);
        }
    }
    policies.iter().all(|policy| {
        policy.implicit_any
            || policy.specified_any
            || policy
                .declared
                .as_ref()
                .is_some_and(|set| set.contains(SERVER_AUTH))
    })
}

fn directory_string(tag: u8, content: &[u8]) -> Option<String> {
    match tag {
        0x0c | 0x13 | 0x16 | 0x14 => String::from_utf8(content.to_vec()).ok(),
        0x1e => {
            let units: Vec<u16> = content
                .chunks(2)
                .map(|pair| u16::from_be_bytes([pair[0], *pair.get(1)?]).into())
                .collect::<Option<_>>()?;
            String::from_utf16(&units).ok()
        }
        _ => None,
    }
}

/// CertificateValidation.BuildChainAndVerifyProperties after
/// TargetHostNameHelper.NormalizeHostName: trailing dots go, then
/// X509Certificate2.MatchesHostname with wildcards and the common name.
pub(crate) fn matches_host(leaf: &[u8], host: &str) -> bool {
    let host = host.trim_end_matches('.');
    if host.is_empty() {
        return false;
    }
    let Some(certificate) = parse(leaf) else {
        return false;
    };
    let address = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
        .ok();
    if let Some(mut value) = certificate.extension(SUBJECT_ALT_NAME) {
        let Some(mut names) = expect(&mut value, 0x30) else {
            return false;
        };
        let parent = host
            .find('.')
            .filter(|&dot| dot > 0)
            .map(|dot| &host[dot + 1..]);
        let mut named = false;
        while !names.is_empty() {
            let Some((tag, content)) = element(&mut names) else {
                return false;
            };
            match (address, tag) {
                (Some(address), 0x87) => {
                    let other = match content.len() {
                        4 => <[u8; 4]>::try_from(content).ok().map(IpAddr::from),
                        16 => <[u8; 16]>::try_from(content).ok().map(IpAddr::from),
                        _ => None,
                    };
                    if other == Some(address) {
                        return true;
                    }
                    named = true;
                }
                (None, 0x82) => {
                    named = true;
                    let Ok(san) = std::str::from_utf8(content) else {
                        continue;
                    };
                    if san.is_empty() {
                        continue;
                    }
                    let san = san.strip_suffix('.').unwrap_or(san);
                    if let Some(rest) = san.strip_prefix("*.").filter(|_| san.len() > 2) {
                        if parent.is_some_and(|p| rest.eq_ignore_ascii_case(p)) {
                            return true;
                        }
                    } else if san.eq_ignore_ascii_case(host) {
                        return true;
                    }
                }
                _ => {}
            }
        }
        if named {
            return false;
        }
    }
    let mut subject = certificate.subject;
    let mut common = None;
    while !subject.is_empty() {
        let Some(mut set) = expect(&mut subject, 0x31) else {
            return false;
        };
        let mut attributes = Vec::new();
        while !set.is_empty() {
            let Some(mut attribute) = expect(&mut set, 0x30) else {
                return false;
            };
            let Some(id) = expect(&mut attribute, 0x06) else {
                return false;
            };
            attributes.push((id, element(&mut attribute)));
        }
        if attributes.len() > 1 {
            if attributes.iter().any(|(id, _)| *id == COMMON_NAME) {
                return false;
            }
            continue;
        }
        if let Some((id, value)) = attributes.first()
            && *id == COMMON_NAME
        {
            if common.is_some() {
                return false;
            }
            common = Some(value.and_then(|(tag, content)| directory_string(tag, content)));
        }
    }
    matches!(common, Some(Some(name)) if name.eq_ignore_ascii_case(host))
}
