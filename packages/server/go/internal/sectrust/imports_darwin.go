//go:build darwin

package sectrust

// The dynamic imports and trampolines crypto/x509/internal/macos uses, so
// no cgo is needed.

//go:cgo_import_dynamic blok_CFRelease CFRelease "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDataCreate CFDataCreate "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDataGetLength CFDataGetLength "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDataGetBytes CFDataGetBytes "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFStringCreateWithBytes CFStringCreateWithBytes "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFStringGetCString CFStringGetCString "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFArrayCreateMutable CFArrayCreateMutable "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFArrayAppendValue CFArrayAppendValue "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFArrayGetCount CFArrayGetCount "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFArrayGetValueAtIndex CFArrayGetValueAtIndex "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDictionaryGetValue CFDictionaryGetValue "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDictionaryGetCount CFDictionaryGetCount "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDictionaryGetKeysAndValues CFDictionaryGetKeysAndValues "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFGetTypeID CFGetTypeID "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFDictionaryGetTypeID CFDictionaryGetTypeID "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_CFStringGetTypeID CFStringGetTypeID "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation"
//go:cgo_import_dynamic blok_SecCertificateCreateWithData SecCertificateCreateWithData "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecCertificateCopyData SecCertificateCopyData "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecPolicyCreateSSL SecPolicyCreateSSL "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecPolicyCreateBasicX509 SecPolicyCreateBasicX509 "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustCreateWithCertificates SecTrustCreateWithCertificates "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustSetNetworkFetchAllowed SecTrustSetNetworkFetchAllowed "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustSetAnchorCertificates SecTrustSetAnchorCertificates "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustSetAnchorCertificatesOnly SecTrustSetAnchorCertificatesOnly "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustEvaluateWithError SecTrustEvaluateWithError "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustGetTrustResult SecTrustGetTrustResult "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustGetCertificateCount SecTrustGetCertificateCount "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustGetCertificateAtIndex SecTrustGetCertificateAtIndex "/System/Library/Frameworks/Security.framework/Versions/A/Security"
//go:cgo_import_dynamic blok_SecTrustCopyResult SecTrustCopyResult "/System/Library/Frameworks/Security.framework/Versions/A/Security"

// Set by the assembly in trampolines_darwin_*.s.
var (
	blok_CFRelease_trampoline_addr                         uintptr
	blok_CFDataCreate_trampoline_addr                      uintptr
	blok_CFDataGetLength_trampoline_addr                   uintptr
	blok_CFDataGetBytes_trampoline_addr                    uintptr
	blok_CFStringCreateWithBytes_trampoline_addr           uintptr
	blok_CFStringGetCString_trampoline_addr                uintptr
	blok_CFArrayCreateMutable_trampoline_addr              uintptr
	blok_CFArrayAppendValue_trampoline_addr                uintptr
	blok_CFArrayGetCount_trampoline_addr                   uintptr
	blok_CFArrayGetValueAtIndex_trampoline_addr            uintptr
	blok_CFDictionaryGetValue_trampoline_addr              uintptr
	blok_CFDictionaryGetCount_trampoline_addr              uintptr
	blok_CFDictionaryGetKeysAndValues_trampoline_addr      uintptr
	blok_CFGetTypeID_trampoline_addr                       uintptr
	blok_CFDictionaryGetTypeID_trampoline_addr             uintptr
	blok_CFStringGetTypeID_trampoline_addr                 uintptr
	blok_SecCertificateCreateWithData_trampoline_addr      uintptr
	blok_SecCertificateCopyData_trampoline_addr            uintptr
	blok_SecPolicyCreateSSL_trampoline_addr                uintptr
	blok_SecPolicyCreateBasicX509_trampoline_addr          uintptr
	blok_SecTrustCreateWithCertificates_trampoline_addr    uintptr
	blok_SecTrustSetNetworkFetchAllowed_trampoline_addr    uintptr
	blok_SecTrustSetAnchorCertificates_trampoline_addr     uintptr
	blok_SecTrustSetAnchorCertificatesOnly_trampoline_addr uintptr
	blok_SecTrustEvaluateWithError_trampoline_addr         uintptr
	blok_SecTrustGetTrustResult_trampoline_addr            uintptr
	blok_SecTrustGetCertificateCount_trampoline_addr       uintptr
	blok_SecTrustGetCertificateAtIndex_trampoline_addr     uintptr
	blok_SecTrustCopyResult_trampoline_addr                uintptr
)
