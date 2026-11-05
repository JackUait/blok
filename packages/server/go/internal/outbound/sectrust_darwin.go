//go:build darwin

package outbound

import (
	"runtime"
	"unsafe"
)

// The calls C#'s MacOsCertificateTrust makes, through the dynamic imports
// and trampolines crypto/x509/internal/macos uses, so no cgo is needed. The
// standard library's own verifier never turns network fetch off.

//go:cgo_import_dynamic blok_CFRelease CFRelease "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDataCreate CFDataCreate "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFStringCreateWithBytes CFStringCreateWithBytes "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFArrayCreateMutable CFArrayCreateMutable "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFArrayAppendValue CFArrayAppendValue "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_SecCertificateCreateWithData SecCertificateCreateWithData "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecPolicyCreateSSL SecPolicyCreateSSL "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustCreateWithCertificates SecTrustCreateWithCertificates "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustSetNetworkFetchAllowed SecTrustSetNetworkFetchAllowed "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustEvaluateWithError SecTrustEvaluateWithError "/System/Library/Frameworks/Security.framework/Versions/A/Security"

// Set by the assembly in sectrust_darwin_*.s.
var (
	blok_CFRelease_trampoline_addr                      uintptr
	blok_CFDataCreate_trampoline_addr                   uintptr
	blok_CFStringCreateWithBytes_trampoline_addr        uintptr
	blok_CFArrayCreateMutable_trampoline_addr           uintptr
	blok_CFArrayAppendValue_trampoline_addr             uintptr
	blok_SecCertificateCreateWithData_trampoline_addr   uintptr
	blok_SecPolicyCreateSSL_trampoline_addr             uintptr
	blok_SecTrustCreateWithCertificates_trampoline_addr uintptr
	blok_SecTrustSetNetworkFetchAllowed_trampoline_addr uintptr
	blok_SecTrustEvaluateWithError_trampoline_addr      uintptr
)

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

// platformTrusts is MacOsCertificateTrust.IsTrusted: SecTrust over chain
// with an SSL policy for host and network fetch off. trustd applies the
// trust settings, "Never Trust" included.
func platformTrusts(chain [][]byte, host string) bool {
	if len(chain) == 0 {
		return false
	}
	var owned []uintptr
	defer func() {
		for _, ref := range owned {
			call(blok_CFRelease_trampoline_addr, ref, 0, 0)
		}
	}()
	keep := func(ref uintptr) uintptr {
		if ref != 0 {
			owned = append(owned, ref)
		}
		return ref
	}
	// A NULL callbacks array does not retain its values; owned does.
	certificates := keep(call(blok_CFArrayCreateMutable_trampoline_addr, 0, 0, 0))
	if certificates == 0 {
		return false
	}
	for _, der := range chain {
		data, _, _ := syscall_syscall6(blok_CFDataCreate_trampoline_addr, 0, uintptr(unsafe.Pointer(unsafe.SliceData(der))), uintptr(len(der)), 0, 0, 0)
		runtime.KeepAlive(der)
		if keep(data) == 0 {
			return false
		}
		certificate := keep(call(blok_SecCertificateCreateWithData_trampoline_addr, 0, data, 0))
		if certificate == 0 {
			return false
		}
		call(blok_CFArrayAppendValue_trampoline_addr, certificates, certificate, 0)
	}
	name, _, _ := syscall_syscall6(blok_CFStringCreateWithBytes_trampoline_addr, 0, uintptr(unsafe.Pointer(unsafe.StringData(host))), uintptr(len(host)), utf8Encoding, 0, 0)
	runtime.KeepAlive(host)
	if keep(name) == 0 {
		return false
	}
	policy := keep(call(blok_SecPolicyCreateSSL_trampoline_addr, 1, name, 0))
	if policy == 0 {
		return false
	}
	var trust uintptr
	status, _, _ := syscall_syscall6(blok_SecTrustCreateWithCertificates_trampoline_addr, certificates, policy, uintptr(unsafe.Pointer(&trust)), 0, 0, 0)
	if int32(status) != 0 || keep(trust) == 0 {
		return false
	}
	if int32(call(blok_SecTrustSetNetworkFetchAllowed_trampoline_addr, trust, 0, 0)) != 0 {
		return false
	}
	var failure uintptr
	trusted, _, _ := syscall_syscall6(blok_SecTrustEvaluateWithError_trampoline_addr, trust, uintptr(unsafe.Pointer(&failure)), 0, 0, 0, 0)
	keep(failure)
	return uint8(trusted) != 0
}
