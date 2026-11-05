//go:build darwin

#include "textflag.h"

// Trampolines for the dynamic imports in imports_darwin.go.

TEXT blok_CFRelease_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFRelease(SB)
GLOBL	·blok_CFRelease_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFRelease_trampoline_addr(SB)/8, $blok_CFRelease_trampoline<>(SB)

TEXT blok_CFDataCreate_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDataCreate(SB)
GLOBL	·blok_CFDataCreate_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDataCreate_trampoline_addr(SB)/8, $blok_CFDataCreate_trampoline<>(SB)

TEXT blok_CFDataGetLength_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDataGetLength(SB)
GLOBL	·blok_CFDataGetLength_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDataGetLength_trampoline_addr(SB)/8, $blok_CFDataGetLength_trampoline<>(SB)

TEXT blok_CFDataGetBytes_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDataGetBytes(SB)
GLOBL	·blok_CFDataGetBytes_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDataGetBytes_trampoline_addr(SB)/8, $blok_CFDataGetBytes_trampoline<>(SB)

TEXT blok_CFStringCreateWithBytes_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFStringCreateWithBytes(SB)
GLOBL	·blok_CFStringCreateWithBytes_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFStringCreateWithBytes_trampoline_addr(SB)/8, $blok_CFStringCreateWithBytes_trampoline<>(SB)

TEXT blok_CFStringGetCString_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFStringGetCString(SB)
GLOBL	·blok_CFStringGetCString_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFStringGetCString_trampoline_addr(SB)/8, $blok_CFStringGetCString_trampoline<>(SB)

TEXT blok_CFArrayCreateMutable_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFArrayCreateMutable(SB)
GLOBL	·blok_CFArrayCreateMutable_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFArrayCreateMutable_trampoline_addr(SB)/8, $blok_CFArrayCreateMutable_trampoline<>(SB)

TEXT blok_CFArrayAppendValue_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFArrayAppendValue(SB)
GLOBL	·blok_CFArrayAppendValue_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFArrayAppendValue_trampoline_addr(SB)/8, $blok_CFArrayAppendValue_trampoline<>(SB)

TEXT blok_CFArrayGetCount_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFArrayGetCount(SB)
GLOBL	·blok_CFArrayGetCount_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFArrayGetCount_trampoline_addr(SB)/8, $blok_CFArrayGetCount_trampoline<>(SB)

TEXT blok_CFArrayGetValueAtIndex_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFArrayGetValueAtIndex(SB)
GLOBL	·blok_CFArrayGetValueAtIndex_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFArrayGetValueAtIndex_trampoline_addr(SB)/8, $blok_CFArrayGetValueAtIndex_trampoline<>(SB)

TEXT blok_CFDictionaryGetValue_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDictionaryGetValue(SB)
GLOBL	·blok_CFDictionaryGetValue_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDictionaryGetValue_trampoline_addr(SB)/8, $blok_CFDictionaryGetValue_trampoline<>(SB)

TEXT blok_CFDictionaryGetCount_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDictionaryGetCount(SB)
GLOBL	·blok_CFDictionaryGetCount_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDictionaryGetCount_trampoline_addr(SB)/8, $blok_CFDictionaryGetCount_trampoline<>(SB)

TEXT blok_CFDictionaryGetKeysAndValues_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDictionaryGetKeysAndValues(SB)
GLOBL	·blok_CFDictionaryGetKeysAndValues_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDictionaryGetKeysAndValues_trampoline_addr(SB)/8, $blok_CFDictionaryGetKeysAndValues_trampoline<>(SB)

TEXT blok_CFGetTypeID_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFGetTypeID(SB)
GLOBL	·blok_CFGetTypeID_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFGetTypeID_trampoline_addr(SB)/8, $blok_CFGetTypeID_trampoline<>(SB)

TEXT blok_CFDictionaryGetTypeID_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDictionaryGetTypeID(SB)
GLOBL	·blok_CFDictionaryGetTypeID_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDictionaryGetTypeID_trampoline_addr(SB)/8, $blok_CFDictionaryGetTypeID_trampoline<>(SB)

TEXT blok_CFStringGetTypeID_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFStringGetTypeID(SB)
GLOBL	·blok_CFStringGetTypeID_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFStringGetTypeID_trampoline_addr(SB)/8, $blok_CFStringGetTypeID_trampoline<>(SB)

TEXT blok_SecCertificateCreateWithData_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecCertificateCreateWithData(SB)
GLOBL	·blok_SecCertificateCreateWithData_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecCertificateCreateWithData_trampoline_addr(SB)/8, $blok_SecCertificateCreateWithData_trampoline<>(SB)

TEXT blok_SecCertificateCopyData_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecCertificateCopyData(SB)
GLOBL	·blok_SecCertificateCopyData_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecCertificateCopyData_trampoline_addr(SB)/8, $blok_SecCertificateCopyData_trampoline<>(SB)

TEXT blok_SecPolicyCreateSSL_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecPolicyCreateSSL(SB)
GLOBL	·blok_SecPolicyCreateSSL_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecPolicyCreateSSL_trampoline_addr(SB)/8, $blok_SecPolicyCreateSSL_trampoline<>(SB)

TEXT blok_SecPolicyCreateBasicX509_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecPolicyCreateBasicX509(SB)
GLOBL	·blok_SecPolicyCreateBasicX509_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecPolicyCreateBasicX509_trampoline_addr(SB)/8, $blok_SecPolicyCreateBasicX509_trampoline<>(SB)

TEXT blok_SecTrustCreateWithCertificates_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustCreateWithCertificates(SB)
GLOBL	·blok_SecTrustCreateWithCertificates_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustCreateWithCertificates_trampoline_addr(SB)/8, $blok_SecTrustCreateWithCertificates_trampoline<>(SB)

TEXT blok_SecTrustSetNetworkFetchAllowed_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustSetNetworkFetchAllowed(SB)
GLOBL	·blok_SecTrustSetNetworkFetchAllowed_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustSetNetworkFetchAllowed_trampoline_addr(SB)/8, $blok_SecTrustSetNetworkFetchAllowed_trampoline<>(SB)

TEXT blok_SecTrustSetAnchorCertificates_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustSetAnchorCertificates(SB)
GLOBL	·blok_SecTrustSetAnchorCertificates_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustSetAnchorCertificates_trampoline_addr(SB)/8, $blok_SecTrustSetAnchorCertificates_trampoline<>(SB)

TEXT blok_SecTrustSetAnchorCertificatesOnly_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustSetAnchorCertificatesOnly(SB)
GLOBL	·blok_SecTrustSetAnchorCertificatesOnly_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustSetAnchorCertificatesOnly_trampoline_addr(SB)/8, $blok_SecTrustSetAnchorCertificatesOnly_trampoline<>(SB)

TEXT blok_SecTrustEvaluateWithError_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustEvaluateWithError(SB)
GLOBL	·blok_SecTrustEvaluateWithError_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustEvaluateWithError_trampoline_addr(SB)/8, $blok_SecTrustEvaluateWithError_trampoline<>(SB)

TEXT blok_SecTrustGetTrustResult_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustGetTrustResult(SB)
GLOBL	·blok_SecTrustGetTrustResult_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustGetTrustResult_trampoline_addr(SB)/8, $blok_SecTrustGetTrustResult_trampoline<>(SB)

TEXT blok_SecTrustGetCertificateCount_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustGetCertificateCount(SB)
GLOBL	·blok_SecTrustGetCertificateCount_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustGetCertificateCount_trampoline_addr(SB)/8, $blok_SecTrustGetCertificateCount_trampoline<>(SB)

TEXT blok_SecTrustGetCertificateAtIndex_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustGetCertificateAtIndex(SB)
GLOBL	·blok_SecTrustGetCertificateAtIndex_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustGetCertificateAtIndex_trampoline_addr(SB)/8, $blok_SecTrustGetCertificateAtIndex_trampoline<>(SB)

TEXT blok_SecTrustCopyResult_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustCopyResult(SB)
GLOBL	·blok_SecTrustCopyResult_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustCopyResult_trampoline_addr(SB)/8, $blok_SecTrustCopyResult_trampoline<>(SB)
