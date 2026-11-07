package blokmcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Uploads turns on image.uploadFile, video.uploadFile, audio.uploadFile and
// file.uploadFile through the host's own uploader, as Node's
// BlokMcpOptions.uploads does.
type Uploads struct {
	Uploader Uploader
	// Root is a folder the agent may upload from by path. stdio only;
	// symlinks out of it are refused. Empty: base64 bytes only.
	Root string
	// Limits per kind (image, video, audio or file), like a media tool's
	// types and maxSize. A zero MaxSize keeps the default: image/*,
	// audio/* and video/* only; 30 MiB, video 100 MiB.
	Limits map[string]UploadLimit
}

// UploadLimit is one kind's limits. Nil Types keeps the tool's own list.
type UploadLimit struct {
	Types   []string
	MaxSize int64
}

// UploadContext is core's UploadContext without the progress and variant
// fields an agent upload never sends.
type UploadContext struct {
	Kind string
	Tool string
}

// UploadFile is the file an agent uploads: its name, its MIME type from the
// name, and its bytes.
type UploadFile struct {
	Name  string
	Type  string
	Bytes []byte
}

// UploadedAsset is where the host put a file. A file card keeps Size and
// MimeType when the host returns them.
type UploadedAsset struct {
	URL      string
	FileName string
	Size     *int64
	MimeType string
}

// Uploader is the host's own uploader, which an agent's upload goes through.
type Uploader interface {
	UploadByFile(ctx context.Context, file UploadFile, upload UploadContext) (UploadedAsset, error)
}

// UploadError lets an uploader tell the agent something on purpose, as
// Node's agentMessage does. Any other error reaches the agent only as "The
// upload failed.": its text may name hosts, paths or credentials. Err is
// logged to stderr either way. Wrapped UploadErrors are found too.
type UploadError struct {
	Err          error
	AgentMessage string
}

func (e *UploadError) Error() string {
	if e.Err == nil {
		return e.AgentMessage
	}
	return e.Err.Error()
}

func (e *UploadError) Unwrap() error { return e.Err }

// URLUploader is an Uploader that also copies a linked file: then
// <tool>.setSource copies a linked file to the host too.
type URLUploader interface {
	UploadByURL(ctx context.Context, url string, upload UploadContext) (UploadedAsset, error)
}

// uploadsCheck is the uploads part of mcpCheckOptions's input.
func (u *Uploads) checkJSON() map[string]any {
	checked := map[string]any{"uploadByFile": u.Uploader != nil}
	if u.Root != "" {
		checked["root"] = u.Root
	}
	if u.Limits != nil {
		checked["limits"] = u.limitsJSON()
	}
	return checked
}

func (u *Uploads) limitsJSON() map[string]any {
	limits := map[string]any{}
	for kind, limit := range u.Limits {
		entry := map[string]any{}
		if limit.Types != nil {
			entry["types"] = limit.Types
		}
		if limit.MaxSize != 0 {
			entry["maxSize"] = limit.MaxSize
		}
		limits[kind] = entry
	}
	return limits
}

// hostUpload is the upload call agentExecute stopped on.
type hostUpload struct {
	Op       string  `json:"op"`
	Path     string  `json:"path"`
	MaxBytes int64   `json:"maxBytes"`
	FileName string  `json:"fileName"`
	Type     string  `json:"type"`
	Kind     string  `json:"kind"`
	Tool     string  `json:"tool"`
	Size     int64   `json:"size"`
	Data     *string `json:"data"`
	Local    *int    `json:"local"`
	URL      string  `json:"url"`
}

// uploadRun keeps one batch's upload answers and the bytes its reads got.
type uploadRun struct {
	answers []any
	reads   map[int][]byte
}

// agentExecute runs the bundle's agentExecute. With uploads on, the bundle
// stops on each upload call it has no answer for; the host runs it and
// sends the batch again with one more answer, as an upload prepare step in
// Node awaits the uploader. unlocked runs the host call, with a live room's
// lock let go.
func (s *Server) agentExecute(ctx context.Context, input map[string]any, out any, unlocked func(func())) error {
	uploads := s.options.Uploads
	if uploads == nil {
		_, err := s.bundle.call(ctx, "agentExecute", input, out)
		return err
	}
	_, byURL := uploads.Uploader.(URLUploader)
	run := &uploadRun{reads: map[int][]byte{}}
	settings := map[string]any{"root": s.localFiles != nil, "byUrl": byURL}
	if uploads.Limits != nil {
		settings["limits"] = uploads.limitsJSON()
	}
	for {
		settings["answers"] = run.answers
		input["uploads"] = settings
		raw, err := s.bundle.call(ctx, "agentExecute", input, nil)
		if err != nil {
			return err
		}
		var step struct {
			Upload *hostUpload `json:"upload"`
		}
		if err := json.Unmarshal(raw, &step); err != nil {
			return err
		}
		if step.Upload == nil {
			return json.Unmarshal(raw, out)
		}
		var answer any
		unlocked(func() { answer = s.runUpload(ctx, step.Upload, run) })
		run.answers = append(run.answers, answer)
	}
}

// runUpload answers one upload call: {failure} for a refusal the agent can
// fix or an UploadError's AgentMessage, {error} for any other failure, else
// what the bundle reads.
func (s *Server) runUpload(ctx context.Context, call *hostUpload, run *uploadRun) any {
	// The bundle answers the agent "The upload failed." for {error}, so the text is only logged.
	thrown := func(err error) any {
		logf("an upload call failed: %v", err)
		return map[string]any{"error": "The upload failed."}
	}
	hostFailed := func(err error) any {
		logf("the host uploader failed: %v", err)
		var said *UploadError
		if errors.As(err, &said) && strings.TrimSpace(said.AgentMessage) != "" {
			return map[string]any{"failure": map[string]any{"code": "TOOL_ACTION_FAILED", "message": said.AgentMessage, "retryable": false}}
		}
		return map[string]any{"error": "The upload failed."}
	}
	upload := UploadContext{Kind: call.Kind, Tool: call.Tool}
	switch call.Op {
	case "readLocal":
		if s.localFiles == nil {
			return thrown(fmt.Errorf("this host reads no local files"))
		}
		bytes, name, err := s.localFiles.read(call.Path, call.MaxBytes)
		if failure, ok := err.(*agentFailure); ok {
			return map[string]any{"failure": failure.errorJSON()}
		}
		if err != nil {
			return thrown(err)
		}
		run.reads[len(run.answers)] = bytes
		return map[string]any{"name": name, "size": len(bytes)}
	case "uploadByFile":
		var bytes []byte
		switch {
		case call.Data != nil:
			decoded, err := base64.StdEncoding.DecodeString(*call.Data)
			if err != nil {
				return thrown(err)
			}
			bytes = decoded
		case call.Local != nil:
			read, ok := run.reads[*call.Local]
			if !ok {
				return thrown(fmt.Errorf("blok-mcp: the upload names no read of this batch"))
			}
			bytes = read
		default:
			return thrown(fmt.Errorf("blok-mcp: the upload names no bytes"))
		}
		// The bundle checked a stand-in of this size; other bytes were not checked.
		if int64(len(bytes)) != call.Size {
			return thrown(fmt.Errorf("blok-mcp: the upload is %d bytes, not the %d the batch checked", len(bytes), call.Size))
		}
		asset, err := s.options.Uploads.Uploader.UploadByFile(ctx, UploadFile{Name: call.FileName, Type: call.Type, Bytes: bytes}, upload)
		if err != nil {
			return hostFailed(err)
		}
		return assetJSON(asset)
	case "uploadByUrl":
		uploader, ok := s.options.Uploads.Uploader.(URLUploader)
		if !ok {
			return thrown(fmt.Errorf("this host copies no linked files"))
		}
		asset, err := uploader.UploadByURL(ctx, call.URL, upload)
		if err != nil {
			return hostFailed(err)
		}
		return assetJSON(asset)
	}
	return thrown(fmt.Errorf("blok-mcp: unknown upload call %q", call.Op))
}

func assetJSON(asset UploadedAsset) map[string]any {
	answer := map[string]any{"url": asset.URL}
	if asset.FileName != "" {
		answer["fileName"] = asset.FileName
	}
	if asset.Size != nil {
		answer["size"] = *asset.Size
	}
	if asset.MimeType != "" {
		answer["mimeType"] = asset.MimeType
	}
	return answer
}
