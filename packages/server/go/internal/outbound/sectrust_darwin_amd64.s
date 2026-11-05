//go:build darwin

#include "textflag.h"

// Trampolines for the dynamic imports in sectrust_darwin.go.

TEXT blok_CFRelease_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFRelease(SB)
GLOBL	·blok_CFRelease_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFRelease_trampoline_addr(SB)/8, $blok_CFRelease_trampoline<>(SB)

TEXT blok_CFDataCreate_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFDataCreate(SB)
GLOBL	·blok_CFDataCreate_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFDataCreate_trampoline_addr(SB)/8, $blok_CFDataCreate_trampoline<>(SB)

TEXT blok_CFStringCreateWithBytes_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFStringCreateWithBytes(SB)
GLOBL	·blok_CFStringCreateWithBytes_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFStringCreateWithBytes_trampoline_addr(SB)/8, $blok_CFStringCreateWithBytes_trampoline<>(SB)

TEXT blok_CFArrayCreateMutable_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFArrayCreateMutable(SB)
GLOBL	·blok_CFArrayCreateMutable_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFArrayCreateMutable_trampoline_addr(SB)/8, $blok_CFArrayCreateMutable_trampoline<>(SB)

TEXT blok_CFArrayAppendValue_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_CFArrayAppendValue(SB)
GLOBL	·blok_CFArrayAppendValue_trampoline_addr(SB), RODATA, $8
DATA	·blok_CFArrayAppendValue_trampoline_addr(SB)/8, $blok_CFArrayAppendValue_trampoline<>(SB)

TEXT blok_SecCertificateCreateWithData_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecCertificateCreateWithData(SB)
GLOBL	·blok_SecCertificateCreateWithData_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecCertificateCreateWithData_trampoline_addr(SB)/8, $blok_SecCertificateCreateWithData_trampoline<>(SB)

TEXT blok_SecPolicyCreateSSL_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecPolicyCreateSSL(SB)
GLOBL	·blok_SecPolicyCreateSSL_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecPolicyCreateSSL_trampoline_addr(SB)/8, $blok_SecPolicyCreateSSL_trampoline<>(SB)

TEXT blok_SecTrustCreateWithCertificates_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustCreateWithCertificates(SB)
GLOBL	·blok_SecTrustCreateWithCertificates_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustCreateWithCertificates_trampoline_addr(SB)/8, $blok_SecTrustCreateWithCertificates_trampoline<>(SB)

TEXT blok_SecTrustSetNetworkFetchAllowed_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustSetNetworkFetchAllowed(SB)
GLOBL	·blok_SecTrustSetNetworkFetchAllowed_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustSetNetworkFetchAllowed_trampoline_addr(SB)/8, $blok_SecTrustSetNetworkFetchAllowed_trampoline<>(SB)

TEXT blok_SecTrustEvaluateWithError_trampoline<>(SB),NOSPLIT,$0-0
	JMP	blok_SecTrustEvaluateWithError(SB)
GLOBL	·blok_SecTrustEvaluateWithError_trampoline_addr(SB), RODATA, $8
DATA	·blok_SecTrustEvaluateWithError_trampoline_addr(SB)/8, $blok_SecTrustEvaluateWithError_trampoline<>(SB)
