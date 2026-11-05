//go:build darwin

package sectrust

import (
	"runtime"
	"unsafe"
)

// Available reports whether trustd can verify here.
const Available = true

//go:linkname syscall_syscall6 syscall.syscall6
func syscall_syscall6(fn, a1, a2, a3, a4, a5, a6 uintptr) (r1, r2, err uintptr)

// call takes no pointers: a Pointer converted to uintptr is kept alive only
// in the argument list of a body-less function like syscall_syscall6, so
// every call that passes one makes that call itself.
func call(fn, a1, a2, a3 uintptr) uintptr {
	r1, _, _ := syscall_syscall6(fn, a1, a2, a3, 0, 0, 0)
	return r1
}

const utf8Encoding = 0x08000100

// refs releases what it holds in reverse order of creation, as Go's own
// verifier does: the trust before its policy, its arrays and their certs.
type refs []uintptr

func (r *refs) keep(ref uintptr) uintptr {
	if ref != 0 {
		*r = append(*r, ref)
	}
	return ref
}

func (r refs) release() {
	for i := len(r) - 1; i >= 0; i-- {
		call(blok_CFRelease_trampoline_addr, r[i], 0, 0)
	}
}

func (r *refs) certificates(ders [][]byte) (uintptr, bool) {
	certificates := make([]uintptr, 0, len(ders))
	for _, der := range ders {
		data, _, _ := syscall_syscall6(blok_CFDataCreate_trampoline_addr, 0, uintptr(unsafe.Pointer(unsafe.SliceData(der))), uintptr(len(der)), 0, 0, 0)
		runtime.KeepAlive(der)
		if data == 0 {
			return 0, false
		}
		certificate := r.keep(call(blok_SecCertificateCreateWithData_trampoline_addr, 0, data, 0))
		call(blok_CFRelease_trampoline_addr, data, 0, 0)
		if certificate == 0 {
			return 0, false
		}
		certificates = append(certificates, certificate)
	}
	// A NULL callbacks array does not retain its values; r does, and
	// releases the array first.
	array := r.keep(call(blok_CFArrayCreateMutable_trampoline_addr, 0, 0, 0))
	if array == 0 {
		return 0, false
	}
	for _, certificate := range certificates {
		call(blok_CFArrayAppendValue_trampoline_addr, array, certificate, 0)
	}
	return array, true
}

func (r *refs) text(s string) uintptr {
	ref, _, _ := syscall_syscall6(blok_CFStringCreateWithBytes_trampoline_addr, 0, uintptr(unsafe.Pointer(unsafe.StringData(s))), uintptr(len(s)), utf8Encoding, 0, 0)
	runtime.KeepAlive(s)
	return r.keep(ref)
}

// trust is SecTrustCreateWithCertificates over chain with one policy,
// anchored to anchors when anchors is not nil.
func (r *refs) trust(chain, anchors [][]byte, policy func() uintptr, anchorsOnly bool) uintptr {
	if len(chain) == 0 {
		return 0
	}
	certificates, ok := r.certificates(chain)
	if !ok {
		return 0
	}
	var anchorArray uintptr
	if anchors != nil {
		if anchorArray, ok = r.certificates(anchors); !ok {
			return 0
		}
	}
	p := r.keep(policy())
	if p == 0 {
		return 0
	}
	var trust uintptr
	status, _, _ := syscall_syscall6(blok_SecTrustCreateWithCertificates_trampoline_addr, certificates, p, uintptr(unsafe.Pointer(&trust)), 0, 0, 0)
	if int32(status) != 0 || r.keep(trust) == 0 {
		return 0
	}
	if anchors != nil {
		if int32(call(blok_SecTrustSetAnchorCertificates_trampoline_addr, trust, anchorArray, 0)) != 0 {
			return 0
		}
		if anchorsOnly && int32(call(blok_SecTrustSetAnchorCertificatesOnly_trampoline_addr, trust, 1, 0)) != 0 {
			return 0
		}
	}
	return trust
}

func (r *refs) evaluate(trust uintptr) bool {
	var failure uintptr
	trusted, _, _ := syscall_syscall6(blok_SecTrustEvaluateWithError_trampoline_addr, trust, uintptr(unsafe.Pointer(&failure)), 0, 0, 0, 0)
	r.keep(failure)
	return uint8(trusted) != 0
}

// Guarded is C#'s MacOsCertificateTrust.IsTrusted: SecTrust over the chain
// as sent, with an SSL policy for host and network fetch off, anchored only
// to anchors when anchors is not nil.
func Guarded(chain [][]byte, host string, anchors [][]byte) bool {
	var r refs
	defer r.release()
	name := r.text(host)
	if name == 0 {
		return false
	}
	trust := r.trust(chain, anchors, func() uintptr {
		return call(blok_SecPolicyCreateSSL_trampoline_addr, 1, name, 0)
	}, true)
	if trust == 0 || int32(call(blok_SecTrustSetNetworkFetchAllowed_trampoline_addr, trust, 0, 0)) != 0 {
		return false
	}
	return r.evaluate(trust)
}

// Operator is SslStream's check for an HttpClient with default options
// (System.Net.Security and System.Security.Cryptography 10.0.11):
// X509Chain on SecTrust with the basic X.509 policy and network fetch on
// (SecTrustChainPal.cs, pal_x509chain.c), read per certificate the way
// MergeStatusCodes does with revocation off, then the serverAuth usage and
// the host name in managed code (names.go). anchors is CustomRootTrust,
// which sets anchors without "anchors only".
func Operator(chain [][]byte, host string, anchors [][]byte) bool {
	var r refs
	defer r.release()
	trust := r.trust(chain, anchors, func() uintptr {
		return call(blok_SecPolicyCreateBasicX509_trampoline_addr, 0, 0, 0)
	}, false)
	if trust == 0 || int32(call(blok_SecTrustSetNetworkFetchAllowed_trampoline_addr, trust, 1, 0)) != 0 {
		return false
	}
	if !r.evaluate(trust) {
		var result uint32
		status, _, _ := syscall_syscall6(blok_SecTrustGetTrustResult_trampoline_addr, trust, uintptr(unsafe.Pointer(&result)), 0, 0, 0, 0)
		if int32(status) != 0 || result == 0 {
			return false
		}
	}
	built, ok := r.builtChain(trust)
	if !ok || !r.detailsPass(trust, len(built)) {
		return false
	}
	return serverAuthAllowed(built) && matchesHost(chain[0], host)
}

func (r *refs) builtChain(trust uintptr) ([][]byte, bool) {
	count := int(call(blok_SecTrustGetCertificateCount_trampoline_addr, trust, 0, 0))
	if count <= 0 {
		return nil, false
	}
	built := make([][]byte, count)
	for i := range built {
		certificate := call(blok_SecTrustGetCertificateAtIndex_trampoline_addr, trust, uintptr(i), 0)
		if certificate == 0 {
			return nil, false
		}
		data := r.keep(call(blok_SecCertificateCopyData_trampoline_addr, certificate, 0, 0))
		if data == 0 {
			return nil, false
		}
		length := int(call(blok_CFDataGetLength_trampoline_addr, data, 0, 0))
		if length <= 0 {
			return nil, false
		}
		built[i] = make([]byte, length)
		// CFRange is passed as its two words.
		syscall_syscall6(blok_CFDataGetBytes_trampoline_addr, data, 0, uintptr(length), uintptr(unsafe.Pointer(unsafe.SliceData(built[i]))), 0, 0)
		runtime.KeepAlive(built[i])
	}
	return built, true
}

// detailsPass reads TrustResultDetails as AppleCryptoNative_X509ChainGetStatusAtIndex
// does: any key that maps to a status fails, as does an unknown key or a
// missing entry, which .NET throws on.
func (r *refs) detailsPass(trust uintptr, count int) bool {
	result := r.keep(call(blok_SecTrustCopyResult_trampoline_addr, trust, 0, 0))
	if result == 0 {
		return false
	}
	key := r.text("TrustResultDetails")
	details := call(blok_CFDictionaryGetValue_trampoline_addr, result, key, 0)
	if details == 0 {
		return false
	}
	if int(call(blok_CFArrayGetCount_trampoline_addr, details, 0, 0)) < count {
		return false
	}
	dictionaryType := call(blok_CFDictionaryGetTypeID_trampoline_addr, 0, 0, 0)
	stringType := call(blok_CFStringGetTypeID_trampoline_addr, 0, 0, 0)
	for i := 0; i < count; i++ {
		entry := call(blok_CFArrayGetValueAtIndex_trampoline_addr, details, uintptr(i), 0)
		if entry == 0 || call(blok_CFGetTypeID_trampoline_addr, entry, 0, 0) != dictionaryType {
			return false
		}
		size := int(call(blok_CFDictionaryGetCount_trampoline_addr, entry, 0, 0))
		if size == 0 {
			continue
		}
		keys := make([]uintptr, size)
		syscall_syscall6(blok_CFDictionaryGetKeysAndValues_trampoline_addr, entry, uintptr(unsafe.Pointer(unsafe.SliceData(keys))), 0, 0, 0, 0)
		runtime.KeepAlive(keys)
		for _, k := range keys {
			if k == 0 || call(blok_CFGetTypeID_trampoline_addr, k, 0, 0) != stringType {
				return false
			}
			buffer := make([]byte, 256)
			ok, _, _ := syscall_syscall6(blok_CFStringGetCString_trampoline_addr, k, uintptr(unsafe.Pointer(unsafe.SliceData(buffer))), uintptr(len(buffer)), utf8Encoding, 0, 0)
			runtime.KeepAlive(buffer)
			if uint8(ok) == 0 {
				return false
			}
			name := string(buffer[:indexZero(buffer)])
			if !passingDetail[name] {
				return false
			}
		}
	}
	return true
}

func indexZero(b []byte) int {
	for i, c := range b {
		if c == 0 {
			return i
		}
	}
	return len(b)
}
