//! _SecCertificateIsSelfSigned (apple-oss-distributions/Security
//! db15acbe6a7f, OSX/sec/Security/SecCertificate.c:6192-6222): the issuer
//! is the subject, an authority key ID equals the subject key ID, and the
//! cert's own key verifies its signature. Apple compares normalized names;
//! the raw bytes here can only say no more often. The signature check is
//! Security.framework's own (SecCertificateCopyKey, SecKeyVerifySignature),
//! which needs no trust evaluation.

use security_framework::certificate::SecCertificate;
use security_framework::key::Algorithm;
use security_framework::os::macos::certificate::SecCertificateExt;

pub(crate) fn self_signed(der: &[u8]) -> bool {
    let Some(parts) = parse(der) else {
        return false;
    };
    if parts.issuer != parts.subject {
        return false;
    }
    if let Some(authority) = parts.authority_key_id
        && Some(authority) != parts.subject_key_id
    {
        return false;
    }
    let Some(algorithm) = algorithm(parts.signature_algorithm) else {
        return false;
    };
    let Ok(certificate) = SecCertificate::from_der(der) else {
        return false;
    };
    // The trait's SecCertificateCopyKey, not the inherent method, which runs
    // a trust evaluation that may fetch issuers.
    let Ok(key) = SecCertificateExt::public_key(&certificate) else {
        return false;
    };
    key.verify_signature(algorithm, parts.tbs, parts.signature)
        .unwrap_or(false)
}

/// The signature algorithms Go's x509 CheckSignature accepts for a root,
/// by OID content bytes. MD5, DSA and RSA-PSS give false.
fn algorithm(oid: &[u8]) -> Option<Algorithm> {
    const RSA: [u8; 8] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01];
    const ECDSA: [u8; 7] = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03];
    match oid {
        [prefix @ .., 0x05] if prefix == RSA => Some(Algorithm::RSASignatureMessagePKCS1v15SHA1),
        [prefix @ .., 0x0b] if prefix == RSA => Some(Algorithm::RSASignatureMessagePKCS1v15SHA256),
        [prefix @ .., 0x0c] if prefix == RSA => Some(Algorithm::RSASignatureMessagePKCS1v15SHA384),
        [prefix @ .., 0x0d] if prefix == RSA => Some(Algorithm::RSASignatureMessagePKCS1v15SHA512),
        [prefix @ .., 0x02] if prefix == ECDSA => Some(Algorithm::ECDSASignatureMessageX962SHA256),
        [prefix @ .., 0x03] if prefix == ECDSA => Some(Algorithm::ECDSASignatureMessageX962SHA384),
        [prefix @ .., 0x04] if prefix == ECDSA => Some(Algorithm::ECDSASignatureMessageX962SHA512),
        _ => None,
    }
}

struct Parts<'a> {
    tbs: &'a [u8],
    signature_algorithm: &'a [u8],
    signature: &'a [u8],
    issuer: &'a [u8],
    subject: &'a [u8],
    subject_key_id: Option<&'a [u8]>,
    authority_key_id: Option<&'a [u8]>,
}

/// One DER element: its tag, its content and the whole element, then the
/// rest of the input.
type Element<'a> = (u8, &'a [u8], &'a [u8], &'a [u8]);

fn element(input: &[u8]) -> Option<Element<'_>> {
    let (&tag, rest) = input.split_first()?;
    let (&first, rest) = rest.split_first()?;
    let (length, rest) = if first < 0x80 {
        (usize::from(first), rest)
    } else {
        let count = usize::from(first & 0x7f);
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        let length = rest[..count]
            .iter()
            .fold(0usize, |n, &b| n << 8 | usize::from(b));
        (length, &rest[count..])
    };
    if rest.len() < length {
        return None;
    }
    let header = input.len() - rest.len();
    Some((
        tag,
        &rest[..length],
        &input[..header + length],
        &rest[length..],
    ))
}

const SEQUENCE: u8 = 0x30;

fn parse(der: &[u8]) -> Option<Parts<'_>> {
    let (SEQUENCE, certificate, _, _) = element(der)? else {
        return None;
    };
    let (SEQUENCE, tbs_content, tbs, rest) = element(certificate)? else {
        return None;
    };
    let (SEQUENCE, algorithm, _, rest) = element(rest)? else {
        return None;
    };
    let (0x06, signature_algorithm, _, _) = element(algorithm)? else {
        return None;
    };
    let (0x03, bits, _, _) = element(rest)? else {
        return None;
    };
    let (&0, signature) = bits.split_first()? else {
        return None;
    };
    let mut fields = tbs_content;
    let (mut tag, _, _, mut rest) = element(fields)?;
    if tag == 0xa0 {
        fields = rest;
        (tag, _, _, rest) = element(fields)?;
    }
    if tag != 0x02 {
        return None;
    }
    let (SEQUENCE, _, _, rest) = element(rest)? else {
        return None;
    };
    let (SEQUENCE, _, issuer, rest) = element(rest)? else {
        return None;
    };
    let (SEQUENCE, _, _, rest) = element(rest)? else {
        return None;
    };
    let (SEQUENCE, _, subject, rest) = element(rest)? else {
        return None;
    };
    let (SEQUENCE, _, _, mut rest) = element(rest)? else {
        return None;
    };
    let mut subject_key_id = None;
    let mut authority_key_id = None;
    while !rest.is_empty() {
        let (tag, content, _, next) = element(rest)?;
        rest = next;
        if tag != 0xa3 {
            continue;
        }
        let (SEQUENCE, mut extensions, _, _) = element(content)? else {
            return None;
        };
        while !extensions.is_empty() {
            let (SEQUENCE, extension, _, next) = element(extensions)? else {
                return None;
            };
            extensions = next;
            let (0x06, oid, _, value) = element(extension)? else {
                return None;
            };
            // A critical flag may come first.
            let (mut tag, mut octets, _, after) = element(value)?;
            if tag == 0x01 {
                (tag, octets, _, _) = element(after)?;
            }
            if tag != 0x04 {
                return None;
            }
            match oid {
                // subjectKeyIdentifier: an OCTET STRING.
                [0x55, 0x1d, 0x0e] => {
                    let (0x04, id, _, _) = element(octets)? else {
                        return None;
                    };
                    subject_key_id = Some(id);
                }
                // authorityKeyIdentifier: its [0] keyIdentifier, as Go reads it.
                [0x55, 0x1d, 0x23] => {
                    let (SEQUENCE, mut inner, _, _) = element(octets)? else {
                        return None;
                    };
                    while !inner.is_empty() {
                        let (tag, id, _, next) = element(inner)?;
                        inner = next;
                        if tag == 0x80 {
                            authority_key_id = Some(id);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Some(Parts {
        tbs,
        signature_algorithm,
        signature,
        issuer,
        subject,
        subject_key_id,
        authority_key_id,
    })
}
