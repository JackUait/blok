package cloud

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
)

func loadAIEncryptionKey(c Config) (cipher.AEAD, error) {
	var key []byte
	if c.AIEncryptionKey != "" {
		var e error
		key, e = base64.StdEncoding.DecodeString(c.AIEncryptionKey)
		if e != nil || len(key) != 32 {
			return nil, errors.New("AI_ENCRYPTION_KEY must be base64 encoding of exactly 32 random bytes")
		}
	} else {
		if e := os.MkdirAll(c.DataDirectory, 0700); e != nil {
			return nil, e
		}
		name := filepath.Join(c.DataDirectory, "ai-key")
		if info, statErr := os.Lstat(name); statErr == nil && !info.Mode().IsRegular() {
			return nil, errors.New("AI encryption key path must be a regular file")
		}
		existing, e := os.ReadFile(name)
		if os.IsNotExist(e) {
			candidate := make([]byte, 32)
			if _, e = io.ReadFull(rand.Reader, candidate); e != nil {
				return nil, e
			}
			f, createErr := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if createErr == nil {
				_, writeErr := f.Write(candidate)
				syncErr := f.Sync()
				closeErr := f.Close()
				if writeErr != nil || syncErr != nil || closeErr != nil {
					return nil, errors.New("could not persist AI encryption key")
				}
				directory, openErr := os.Open(c.DataDirectory)
				if openErr != nil {
					return nil, openErr
				}
				syncDirErr := directory.Sync()
				directory.Close()
				if syncDirErr != nil {
					return nil, syncDirErr
				}
				existing = candidate
			} else if os.IsExist(createErr) {
				existing, e = os.ReadFile(name)
				if e != nil {
					return nil, e
				}
			} else {
				return nil, createErr
			}
		} else if e != nil {
			return nil, e
		}
		if len(existing) != 32 {
			return nil, errors.New("invalid persisted AI encryption key; restore it from backup")
		}
		if e = os.Chmod(name, 0600); e != nil {
			return nil, e
		}
		key = existing
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(block)
}
func (s *Service) encryptAI(plain, owner string) ([]byte, error) {
	nonce := make([]byte, s.aiCipher.NonceSize())
	if _, e := io.ReadFull(rand.Reader, nonce); e != nil {
		return nil, e
	}
	return s.aiCipher.Seal(nonce, nonce, []byte(plain), []byte("blok:openai:v1:"+owner)), nil
}
func (s *Service) decryptAI(encoded []byte, owner string) (string, error) {
	n := s.aiCipher.NonceSize()
	if len(encoded) < n {
		return "", errors.New("invalid encrypted AI credential")
	}
	plain, e := s.aiCipher.Open(nil, encoded[:n], encoded[n:], []byte("blok:openai:v1:"+owner))
	if e != nil {
		return "", errors.New("could not decrypt AI credential")
	}
	return string(plain), nil
}
