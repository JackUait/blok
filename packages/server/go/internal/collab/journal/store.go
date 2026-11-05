package journal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"iter"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/JackUait/blok/packages/server/go/internal/collab/operation"
	"github.com/JackUait/blok/packages/server/go/internal/collab/workingset"
)

// syncJournal is the append's flush; tests swap it to stage a failed fsync.
var syncJournal = func(file *os.File) error { return file.Sync() }

// DefaultMaxUpdateBytes matches the default CollabMaxMessageBytes. The codec's
// 32 MiB ceiling is only a backstop; the wire limit is the policy.
const DefaultMaxUpdateBytes = 1 << 20

const (
	lockName      = "lock"
	purgeName     = "purged"
	journalSuffix = ".journal"
)

// StoreOptions configures a Store. A zero MaxUpdateBytes is the default; Now
// is time.Now unless set (tests pin it).
type StoreOptions struct {
	MaxUpdateBytes int64
	Log            func(string)
	Now            func() time.Time
}

// Store is the built-in operation store (C# LocalCollabOperationStore): one
// append-only, checksummed journal per document under
// <dir>/<doc key>.journal/. It writes the same bytes and names as C#, so
// either server opens the other's directory.
//
// The lock file decides liveness only; the fence in the manifest decides
// who may write. Every append, checkpoint and reset re-reads the manifest
// from its path first. One process per directory.
//
// It must open a document before anything reads it through
// workingset.LocalStore: that store moves an unreadable working set aside,
// and the import here would then see no file and seed an empty document.
type Store struct {
	dir            string
	maxUpdateBytes int64
	log            func(string)
	now            func() time.Time

	gatesMu sync.Mutex
	// One ledger writer per document in this process. A history delete takes
	// no lock file and is guarded by this alone.
	gates map[string]*sync.Mutex
}

// NewStore refuses a limit the record format cannot carry, so the mistake
// shows at start-up rather than as a failed append.
func NewStore(dir string, options StoreOptions) (*Store, error) {
	if dir == "" {
		return nil, argumentf("The value cannot be an empty string.")
	}
	limit := options.MaxUpdateBytes
	if limit == 0 {
		limit = DefaultMaxUpdateBytes
	}
	if limit < 1 || limit > MaxUpdateLength {
		return nil, outOfRangef("collab: the update limit must be 1..%d bytes.", MaxUpdateLength)
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &Store{dir: dir, maxUpdateBytes: limit, log: options.Log, now: now, gates: map[string]*sync.Mutex{}}, nil
}

// MaxUpdateBytes is the append limit, which the restore gate also reads.
func (s *Store) MaxUpdateBytes() int64 { return s.maxUpdateBytes }

func (s *Store) logf(format string, args ...any) {
	if s.log != nil {
		s.log(fmt.Sprintf(format, args...))
	}
}

func (s *Store) gate(docID string) *sync.Mutex {
	s.gatesMu.Lock()
	defer s.gatesMu.Unlock()
	gate, ok := s.gates[docID]
	if !ok {
		gate = &sync.Mutex{}
		s.gates[docID] = gate
	}
	return gate
}

func (s *Store) docDirectory(docID string) string {
	return filepath.Join(s.dir, workingset.DocKey(docID)+journalSuffix)
}

// OpenOutcome is CollabDocumentOpenOutcome.
type OpenOutcome int

const (
	Opened OpenOutcome = iota
	DocumentOpenElsewhere
	DocumentPurged
)

func (o OpenOutcome) String() string {
	return [...]string{"Opened", "DocumentOpenElsewhere", "Purged"}[o]
}

// PurgeOutcome is CollabDocumentPurgeOutcome.
type PurgeOutcome int

const (
	Purged PurgeOutcome = iota
	PurgeOpenElsewhere
)

func (o PurgeOutcome) String() string {
	return [...]string{"Purged", "DocumentOpenElsewhere"}[o]
}

// LineageDeleteOutcome is CollabLineageDeleteOutcome.
type LineageDeleteOutcome int

const (
	LineageDeletedOutcome LineageDeleteOutcome = iota
	LineageNotFound
	LineageCurrent
	LineagePurged
)

func (o LineageDeleteOutcome) String() string {
	return [...]string{"Deleted", "NotFound", "Current", "Purged"}[o]
}

// LineageInfo is CollabLineageInfo. CreatedAt is nil for a lineage that
// began before the ledger existed.
type LineageInfo struct {
	Lineage   string
	Epoch     int64
	Format    int32
	CreatedAt *time.Time
	Current   bool
}

// RecordHeader is CollabRecordHeader.
type RecordHeader struct {
	Sequence    uint64
	CommittedAt time.Time
	ActorID     *string
}

func journalName(generation, mintedBy uint64) string {
	return "journal." + strconv.FormatUint(generation, 10) + "." + strconv.FormatUint(mintedBy, 10)
}

func baselineName(generation, mintedBy uint64) string {
	return "baseline." + strconv.FormatUint(generation, 10) + "." + strconv.FormatUint(mintedBy, 10)
}

func checkpointName(generation, through, writtenBy uint64) string {
	return "checkpoint." + strconv.FormatUint(generation, 10) + "." +
		strconv.FormatUint(through, 10) + "." + strconv.FormatUint(writtenBy, 10)
}

// fileExists is File.Exists: true for a file, false for a directory.
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// globFiles is Directory.GetFiles(dir, stem + ".*"): files only, and .NET's
// Win32 matching also takes a bare stem. A variable so a test can fail it.
var globFiles = func(dir, stem string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		name := entry.Name()
		if name != stem && !strings.HasPrefix(name, stem+".") {
			continue
		}
		if info, err := os.Stat(filepath.Join(dir, name)); err != nil || info.IsDir() {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

func (s *Store) ensureDirectory(docDir string) error {
	if dirExists(docDir) {
		return nil
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	if err := os.Mkdir(docDir, 0o700); err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	return syncDirectory(s.dir)
}

// Open takes the document's fence and reads back everything needed to
// rebuild it. A live holder elsewhere is DocumentOpenElsewhere; a purged
// document is DocumentPurged. Neither returns a session.
func (s *Store) Open(ctx context.Context, docID string) (OpenOutcome, *Session, error) {
	if docID == "" {
		return 0, nil, argumentf("The value cannot be an empty string.")
	}
	if err := ctx.Err(); err != nil {
		return 0, nil, err
	}
	docDir := s.docDirectory(docID)
	if err := s.ensureDirectory(docDir); err != nil {
		return 0, nil, err
	}
	hold, refusal, err := tryHold(filepath.Join(docDir, lockName))
	if err != nil {
		return 0, nil, err
	}
	if hold == nil {
		// A disk fault can look like a live holder here, as in C#; the
		// reason is logged so an operator is not left guessing.
		s.logf("collab: \"%s\" is held elsewhere: %s", docID, refusal)
		return DocumentOpenElsewhere, nil, nil
	}
	session, err := s.open(docID, docDir, hold)
	if err != nil {
		// A refused open releases its hold, so the next attempt reports the
		// same failure instead of "held elsewhere".
		hold.Close()
		return 0, nil, err
	}
	if session == nil {
		hold.Close()
		return DocumentPurged, nil, nil
	}
	return Opened, session, nil
}

// tryHold refuses on any I/O error but a missing path, a long name and a
// permission fault, which C# lets escape (UnauthorizedAccessException is not
// an IOException there).
func tryHold(path string) (*os.File, string, error) {
	file, err := openFile(path, os.O_RDWR|os.O_CREATE, true)
	if err == nil {
		return file, "", nil
	}
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR) ||
		errors.Is(err, syscall.ENAMETOOLONG) || errors.Is(err, fs.ErrPermission) {
		return nil, "", err
	}
	return nil, err.Error(), nil
}

func (s *Store) open(docID, docDir string, hold *os.File) (*Session, error) {
	if fileExists(filepath.Join(docDir, purgeName)) {
		return nil, nil
	}
	manifestPath := filepath.Join(docDir, ManifestFileName)
	stored, err := ReadManifest(manifestPath, docID)
	if err != nil {
		return nil, err
	}
	if stored == nil {
		journals, err := globFiles(docDir, "journal")
		if err != nil {
			return nil, err
		}
		if len(journals) > 0 {
			return nil, invalidData("collab: \"%s\" has journal files but no manifest naming their lineage; refusing to treat it as an unseeded document.", docID)
		}
	}
	current := unseededManifest()
	if stored != nil {
		current = *stored
	}
	manifestFile, err := openManifest(manifestPath)
	if err != nil {
		return nil, err
	}
	var journal *os.File
	fail := func(err error) (*Session, error) {
		if journal != nil {
			journal.Close()
		}
		manifestFile.Close()
		return nil, err
	}

	// The fence is taken before recovery touches a byte, so a holder still
	// alive is refused by its own next fence check.
	fenced := current
	fenced.WriteCounter++
	fenced.Fence++
	if err := publish(manifestFile, fenced); err != nil {
		return fail(err)
	}
	if stored == nil {
		// The manifest's directory entry is new; later publications write in place.
		if err := syncDirectory(docDir); err != nil {
			return fail(err)
		}
	}
	if !fenced.Seeded {
		if fenced, err = s.importWorkingSet(docDir, manifestFile, docID, fenced); err != nil {
			return fail(err)
		}
	}
	s.recordLineage(docDir, docID, fenced, nil)

	index := newJournalIndex()
	var records []operation.Record
	var baseline [][]byte
	var checkpoint *operation.Checkpoint
	if fenced.Seeded {
		if baseline, err = readBaseline(docDir, fenced, docID); err != nil {
			return fail(err)
		}
		journalPath := filepath.Join(docDir, journalName(fenced.Generation, fenced.GenerationFence))
		// Open, never create: a missing journal must fail, not read as a
		// fresh lineage that would reassign taken sequences.
		journal, err = openFile(journalPath, os.O_RDWR, false)
		if errors.Is(err, fs.ErrNotExist) {
			if !dirExists(docDir) {
				return fail(&InvalidDataError{
					Message: fmt.Sprintf("collab: the journal directory for \"%s\" is gone, so %s cannot be read.", docID, filepath.Base(journalPath)),
					Err:     err,
				})
			}
			return fail(&InvalidDataError{
				Message: fmt.Sprintf("collab: \"%s\" names %s, which is not there.", docID, filepath.Base(journalPath)),
				Err:     err,
			})
		}
		if err != nil {
			return fail(err)
		}
		records, err = scanForward(journal, index, docID, func() error { return requireFence(docDir, docID, fenced) })
		if err != nil {
			return fail(err)
		}
		if fenced.CheckpointThrough > index.durableThrough {
			return fail(invalidData("collab: the manifest for \"%s\" names checkpoint %d but the journal only reaches %d.", docID, fenced.CheckpointThrough, index.durableThrough))
		}
		if fenced.CheckpointThrough > 0 {
			if checkpoint, err = readCheckpoint(docDir, fenced, docID); err != nil {
				return fail(err)
			}
		}
	}
	result := operation.OpenResult{Baseline: baseline, Checkpoint: checkpoint}
	if result.Baseline == nil {
		result.Baseline = [][]byte{}
	}
	if fenced.Seeded {
		result.Head = &operation.Head{
			Format: fenced.Format, Epoch: fenced.Epoch, Lineage: fenced.Lineage,
			DurableThrough: index.durableThrough,
		}
	}
	for _, record := range records {
		if record.Sequence > fenced.CheckpointThrough {
			result.Tail = append(result.Tail, record)
		}
	}
	return &Session{
		store: s, docID: docID, docDir: docDir, hold: hold, manifestFile: manifestFile,
		journal: journal, manifest: fenced, index: index, openResult: result,
	}, nil
}

func unseededManifest() Manifest {
	return Manifest{Lineage: strings.Repeat("0", workingset.LineageLength)}
}

func openManifest(path string) (*os.File, error) {
	file, err := openFile(path, os.O_RDWR|os.O_CREATE, false)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err == nil && info.Size() < ManifestSize {
		err = file.Truncate(ManifestSize)
	}
	if err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}

// publish writes slot WriteCounter&1 in place. A torn write damages only the
// slot it was writing, so publication needs no rename and no directory sync.
func publish(manifestFile *os.File, next Manifest) error {
	if _, err := manifestFile.WriteAt(EncodeManifestSlot(next), int64(next.WriteCounter&1)*ManifestSlotSize); err != nil {
		return err
	}
	return manifestFile.Sync()
}

// requireFence re-reads the manifest from its path, never from a handle: a
// replaced manifest leaves an old handle on an inode nobody writes.
func requireFence(docDir, docID string, held Manifest) error {
	if fileExists(filepath.Join(docDir, purgeName)) {
		return ErrFenceLost
	}
	onDisk, err := ReadManifest(filepath.Join(docDir, ManifestFileName), docID)
	if err != nil {
		return err
	}
	if onDisk == nil || onDisk.Fence != held.Fence || onDisk.Generation != held.Generation {
		return ErrFenceLost
	}
	return nil
}

// importWorkingSet adopts workingset.LocalStore's whole-document file, at the
// unsuffixed key beside the journal directory, as the sequence-zero baseline,
// keeping its format, epoch, lineage and frame bytes. The manifest
// publication is the whole migration, so a crash before it changes nothing
// and the old file is left in place. A file that does not decode fails the
// open: treating it as absent would seed a blank page over the user's content.
func (s *Store) importWorkingSet(docDir string, manifestFile *os.File, docID string, fenced Manifest) (Manifest, error) {
	document, err := readShared(filepath.Join(s.dir, workingset.DocKey(docID)))
	if errors.Is(err, fs.ErrNotExist) {
		return fenced, nil
	}
	if err != nil {
		return fenced, err
	}
	tag, frameSection, reason, ok := workingset.DecodeDocument(document)
	if !ok {
		return fenced, invalidData("collab: the working set for \"%s\" is unreadable (%s), so it cannot be imported; refusing to open the document as a new, empty one.", docID, reason)
	}
	generation := fenced.Generation + 1
	// The minting fence is in both names, so a retry after a crash writes new
	// names instead of rewriting the abandoned attempt's.
	mintedBy := fenced.Fence
	if err := WriteSealed(filepath.Join(docDir, baselineName(generation, mintedBy)), BaselineMagic, 0, frameSection); err != nil {
		return fenced, err
	}
	journal, err := openFile(filepath.Join(docDir, journalName(generation, mintedBy)), os.O_RDWR|os.O_CREATE, false)
	if err != nil {
		return fenced, err
	}
	err = requireFence(docDir, docID, fenced)
	if err == nil {
		err = journal.Truncate(0)
	}
	if err == nil {
		err = journal.Sync()
	}
	if closeErr := journal.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fenced, err
	}
	if err := syncDirectory(docDir); err != nil {
		return fenced, err
	}
	published := fenced
	published.WriteCounter++
	published.Generation = generation
	published.GenerationFence = mintedBy
	published.CheckpointFence = 0
	published.Seeded = true
	published.Format = tag.Format
	published.Epoch = tag.Epoch
	published.Lineage = tag.Lineage
	published.CheckpointThrough = 0
	// Re-checked right before the slot write: sealing the old document takes
	// time, and a new holder may have taken the document meanwhile.
	if err := requireFence(docDir, docID, fenced); err != nil {
		return fenced, err
	}
	if err := publish(manifestFile, published); err != nil {
		return fenced, err
	}
	s.logf("collab: imported the working set for \"%s\" as the baseline of lineage %s at epoch %d; the old file is left in place.", docID, tag.Lineage, tag.Epoch)
	return published, nil
}

func readBaseline(docDir string, manifest Manifest, docID string) ([][]byte, error) {
	content, _, err := ReadSealed(filepath.Join(docDir, baselineName(manifest.Generation, manifest.GenerationFence)), BaselineMagic, docID)
	if err != nil {
		return nil, err
	}
	frames, ok := workingset.DecodeFrames(content)
	if !ok {
		return nil, invalidData("collab: the baseline for \"%s\" is not a valid frame section.", docID)
	}
	if frames == nil {
		frames = [][]byte{}
	}
	return frames, nil
}

func readCheckpoint(docDir string, manifest Manifest, docID string) (*operation.Checkpoint, error) {
	state, through, err := ReadSealed(filepath.Join(docDir, checkpointName(manifest.Generation, manifest.CheckpointThrough, manifest.CheckpointFence)), CheckpointMagic, docID)
	if err != nil {
		return nil, err
	}
	if through != manifest.CheckpointThrough {
		return nil, invalidData("collab: the checkpoint file for \"%s\" carries sequence %d, but the manifest names %d.", docID, through, manifest.CheckpointThrough)
	}
	return &operation.Checkpoint{Through: through, State: state}, nil
}

type indexEntry struct {
	sequence uint64
	digest   []byte
}

type journalIndex struct {
	byID           map[string]indexEntry
	durableThrough uint64
	// scannedThrough is the byte offset before which every record is indexed.
	scannedThrough int64
}

func newJournalIndex() *journalIndex {
	return &journalIndex{byID: map[string]indexEntry{}}
}

func (i *journalIndex) clear() {
	clear(i.byID)
	i.durableThrough = 0
	i.scannedThrough = 0
}

// scanForward walks every record written since the last scan. Corruption
// fails: no linear reader can find the record after an invalid one. A torn
// tail is cut only when confirmFence is set (the paths about to write), and only
// after confirmFence says this session still holds the fence: the cut is a bulk
// delete decided from bytes read a moment ago.
func scanForward(journal *os.File, index *journalIndex, docID string, confirmFence func() error) ([]operation.Record, error) {
	info, err := journal.Stat()
	if err != nil {
		return nil, err
	}
	length := info.Size()
	if length < index.scannedThrough {
		return nil, invalidData("collab: the journal for \"%s\" shrank from %d to %d bytes underneath this session.", docID, index.scannedThrough, length)
	}
	if length == index.scannedThrough {
		return nil, nil
	}
	pending := make([]byte, length-index.scannedThrough)
	if _, err := journal.ReadAt(pending, index.scannedThrough); err != nil {
		return nil, err
	}
	var records []operation.Record
	offset := 0
	for offset < len(pending) {
		status, record, consumed, message := DecodeRecord(pending[offset:])
		if status == StatusIncomplete {
			if confirmFence != nil {
				if err := confirmFence(); err != nil {
					return nil, err
				}
				if err := journal.Truncate(index.scannedThrough + int64(offset)); err != nil {
					return nil, err
				}
				if err := journal.Sync(); err != nil {
					return nil, err
				}
			}
			break
		}
		if status != StatusOK || record == nil {
			return nil, invalidData("collab: the journal for \"%s\" is corrupt at byte %d: %s.", docID, index.scannedThrough+int64(offset), message)
		}
		if record.Sequence != index.durableThrough+1 {
			return nil, invalidData("collab: the journal for \"%s\" jumps from sequence %d to %d.", docID, index.durableThrough, record.Sequence)
		}
		if _, taken := index.byID[record.OperationID]; taken {
			return nil, invalidData("collab: the journal for \"%s\" commits the operation id %s twice.", docID, record.OperationID)
		}
		index.byID[record.OperationID] = indexEntry{sequence: record.Sequence, digest: bytes.Clone(record.Digest)}
		index.durableThrough = record.Sequence
		records = append(records, *record)
		offset += consumed
	}
	index.scannedThrough += int64(offset)
	return records, nil
}

// Purge permanently removes one document's journal and blocks future opens.
// The marker is made durable before any payload goes, so a failed cleanup
// keeps it and a retry finishes.
func (s *Store) Purge(ctx context.Context, docID string) (PurgeOutcome, error) {
	if docID == "" {
		return 0, argumentf("The value cannot be an empty string.")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	// Under the ledger gate, so a history delete cannot write its tombstone
	// after the purge removed the ledger.
	gate := s.gate(docID)
	gate.Lock()
	defer gate.Unlock()

	docDir := s.docDirectory(docID)
	if err := s.ensureDirectory(docDir); err != nil {
		return 0, err
	}
	hold, err := openFile(filepath.Join(docDir, lockName), os.O_RDWR|os.O_CREATE, true)
	if err != nil {
		if isHeldElsewhere(err) {
			s.logf("collab: \"%s\" is held elsewhere: %s", docID, err.Error())
			return PurgeOpenElsewhere, nil
		}
		return 0, err
	}
	defer hold.Close()

	marker, err := openFile(filepath.Join(docDir, purgeName), os.O_WRONLY|os.O_CREATE, true)
	if err != nil {
		return 0, err
	}
	err = marker.Sync()
	if closeErr := marker.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return 0, err
	}
	if err := syncDirectory(docDir); err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(docDir)
	if err != nil {
		return 0, err
	}
	// The kept names are found exactly, else ignoring case, as C# does on a
	// case-insensitive volume.
	lockEntry := keptEntry(entries, lockName)
	purgeEntry := keptEntry(entries, purgeName)
	for _, entry := range entries {
		if name := entry.Name(); name != lockEntry && name != purgeEntry {
			if err := removeFile(filepath.Join(docDir, name)); err != nil {
				return 0, err
			}
		}
	}
	if err := syncDirectory(docDir); err != nil {
		return 0, err
	}
	return Purged, nil
}

func keptEntry(entries []os.DirEntry, name string) string {
	for _, entry := range entries {
		if entry.Name() == name {
			return name
		}
	}
	for _, entry := range entries {
		if strings.EqualFold(entry.Name(), name) {
			return entry.Name()
		}
	}
	return name
}

// IsPurged reports the purge marker without opening the document.
func (s *Store) IsPurged(ctx context.Context, docID string) (bool, error) {
	if docID == "" {
		return false, argumentf("The value cannot be an empty string.")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	return fileExists(filepath.Join(s.docDirectory(docID), purgeName)), nil
}

// resolveLineages lists every listed lineage, oldest first, with no lock and
// creating nothing. current is the manifest when it is seeded.
func (s *Store) resolveLineages(docDir, docID string) ([]LineageEntry, *Manifest, error) {
	if !dirExists(docDir) || fileExists(filepath.Join(docDir, purgeName)) {
		return nil, nil, nil
	}
	var current *Manifest
	manifest, err := ReadManifest(filepath.Join(docDir, ManifestFileName), docID)
	if err != nil {
		return nil, nil, err
	}
	if manifest != nil && manifest.Seeded {
		current = manifest
	}
	entries, err := ReadLedger(filepath.Join(docDir, LedgerFileName), s.log)
	if err != nil {
		return nil, nil, err
	}
	type generationKey struct{ generation, fence uint64 }
	deleted := map[generationKey]bool{}
	var published []LineageEntry
	for _, entry := range entries {
		switch {
		case entry.Kind == LineageDeleted:
			deleted[generationKey{entry.Generation, entry.GenerationFence}] = true
		case entry.Kind == LineagePublished && entry.Generation != 0:
			published = append(published, entry)
		}
	}
	// A document not opened since the ledger shipped has no entry for its
	// current generation; it is added here, in memory only.
	if current != nil && !slices.ContainsFunc(published, func(entry LineageEntry) bool {
		return entry.Generation == current.Generation && entry.GenerationFence == current.GenerationFence
	}) {
		published = append(published, LineageEntry{
			Kind: LineagePublished, Generation: current.Generation, GenerationFence: current.GenerationFence,
			Lineage: current.Lineage, Epoch: current.Epoch, Format: current.Format,
		})
	}
	// The newest generation wins a shared lineage, and older ones stay hidden
	// even after the newest is deleted.
	// order keeps first-seen order, as C#'s Dictionary does; the sort below
	// is stable, so lineages that share a generation keep it.
	newest := map[string]LineageEntry{}
	var order []string
	for _, entry := range published {
		seen, ok := newest[entry.Lineage]
		if !ok {
			order = append(order, entry.Lineage)
		}
		if !ok || entry.Generation >= seen.Generation {
			newest[entry.Lineage] = entry
		}
	}
	var lineages []LineageEntry
	for _, lineage := range order {
		entry := newest[lineage]
		if !deleted[generationKey{entry.Generation, entry.GenerationFence}] {
			lineages = append(lineages, entry)
		}
	}
	slices.SortStableFunc(lineages, func(a, b LineageEntry) int {
		switch {
		case a.Generation < b.Generation:
			return -1
		case a.Generation > b.Generation:
			return 1
		}
		return 0
	})
	return lineages, current, nil
}

func (s *Store) findLineage(docDir, docID, lineage string) (*LineageEntry, error) {
	lineages, _, err := s.resolveLineages(docDir, docID)
	if err != nil {
		return nil, err
	}
	for _, entry := range lineages {
		if entry.Lineage == lineage {
			return &entry, nil
		}
	}
	return nil, nil
}

// ListLineages lists every lineage oldest first; only the live one is Current.
func (s *Store) ListLineages(ctx context.Context, docID string) ([]LineageInfo, error) {
	if docID == "" {
		return nil, argumentf("The value cannot be an empty string.")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	lineages, current, err := s.resolveLineages(s.docDirectory(docID), docID)
	if err != nil {
		return nil, err
	}
	infos := []LineageInfo{}
	for _, entry := range lineages {
		infos = append(infos, LineageInfo{
			Lineage: entry.Lineage, Epoch: entry.Epoch, Format: entry.Format, CreatedAt: entry.CreatedAt,
			Current: current != nil && entry.Generation == current.Generation && entry.GenerationFence == current.GenerationFence,
		})
	}
	return infos, nil
}

// ReadBaseline returns a lineage's baseline frames; found is false for a
// lineage that is not listed (or was deleted while this read ran).
func (s *Store) ReadBaseline(ctx context.Context, docID, lineage string) ([][]byte, bool, error) {
	if docID == "" {
		return nil, false, argumentf("The value cannot be an empty string.")
	}
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	docDir := s.docDirectory(docID)
	entry, err := s.findLineage(docDir, docID, lineage)
	if err != nil || entry == nil {
		return nil, false, err
	}
	manifest := unseededManifest()
	manifest.Generation = entry.Generation
	manifest.GenerationFence = entry.GenerationFence
	frames, err := readBaseline(docDir, manifest, docID)
	if err != nil {
		var invalid *InvalidDataError
		if errors.As(err, &invalid) && errors.Is(invalid.Err, fs.ErrNotExist) {
			if again, findErr := s.findLineage(docDir, docID, lineage); findErr == nil && again == nil {
				return nil, false, nil
			}
		}
		return nil, false, err
	}
	return frames, true, nil
}

// ReadHeaders yields each record's sequence, time and actor.
func (s *Store) ReadHeaders(ctx context.Context, docID, lineage string) iter.Seq2[RecordHeader, error] {
	return func(yield func(RecordHeader, error) bool) {
		for record, err := range s.ReadRecords(ctx, docID, lineage, ^uint64(0)) {
			if !yield(RecordHeader{Sequence: record.Sequence, CommittedAt: record.CommittedAt, ActorID: record.ActorID}, err) || err != nil {
				return
			}
		}
	}
}

// ReadRecords yields a lineage's records up to through, without any lock: a
// live session may keep appending. It stops at a torn tail and never writes.
// An error is yielded once, last.
func (s *Store) ReadRecords(ctx context.Context, docID, lineage string, through uint64) iter.Seq2[operation.Record, error] {
	return func(yield func(operation.Record, error) bool) {
		if docID == "" {
			yield(operation.Record{}, argumentf("The value cannot be an empty string."))
			return
		}
		if err := ctx.Err(); err != nil {
			yield(operation.Record{}, err)
			return
		}
		docDir := s.docDirectory(docID)
		if through == 0 {
			return
		}
		entry, err := s.findLineage(docDir, docID, lineage)
		if err != nil {
			yield(operation.Record{}, err)
			return
		}
		if entry == nil {
			return
		}
		file, err := s.openHistoryJournal(docDir, docID, lineage, *entry)
		if err != nil {
			yield(operation.Record{}, err)
			return
		}
		if file == nil {
			return
		}
		defer file.Close()
		reader := historyReader{file: file, docID: docID, buffer: make([]byte, 64*1024)}
		for {
			record, err := reader.next(ctx)
			if err != nil {
				yield(operation.Record{}, err)
				return
			}
			if record == nil || record.Sequence > through {
				return
			}
			if !yield(*record, nil) {
				return
			}
		}
	}
}

// openHistoryJournal is nil when the lineage was deleted meanwhile; a journal
// missing while its lineage is still listed is corruption.
func (s *Store) openHistoryJournal(docDir, docID, lineage string, entry LineageEntry) (*os.File, error) {
	path := filepath.Join(docDir, journalName(entry.Generation, entry.GenerationFence))
	file, err := openFile(path, os.O_RDONLY, false)
	if errors.Is(err, fs.ErrNotExist) {
		again, findErr := s.findLineage(docDir, docID, lineage)
		if findErr != nil {
			return nil, findErr
		}
		if again == nil {
			return nil, nil
		}
		return nil, &InvalidDataError{
			Message: fmt.Sprintf("collab: \"%s\" lists lineage %s, but %s is not there.", docID, lineage, filepath.Base(path)),
			Err:     err,
		}
	}
	return file, err
}

// historyReader decodes a journal one record at a time for history reads.
type historyReader struct {
	file       *os.File
	docID      string
	buffer     []byte
	start, end int
	offset     int64
	sequence   uint64
	atEnd      bool
}

func (r *historyReader) next(ctx context.Context) (*operation.Record, error) {
	for {
		status, record, consumed, message := DecodeRecord(r.buffer[r.start:r.end])
		switch {
		case status == StatusOK && record != nil:
			if record.Sequence != r.sequence+1 {
				return nil, invalidData("collab: the journal for \"%s\" jumps from sequence %d to %d.", r.docID, r.sequence, record.Sequence)
			}
			r.sequence = record.Sequence
			r.start += consumed
			r.offset += int64(consumed)
			return record, nil
		case status != StatusIncomplete:
			return nil, invalidData("collab: the journal for \"%s\" is corrupt at byte %d: %s.", r.docID, r.offset, message)
		}
		if r.atEnd {
			return nil, nil
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if r.start > 0 {
			copy(r.buffer, r.buffer[r.start:r.end])
			r.end -= r.start
			r.start = 0
		}
		// A record longer than the buffer stays incomplete until it fits.
		if r.end == len(r.buffer) {
			r.buffer = append(r.buffer, make([]byte, len(r.buffer))...)
		}
		read, err := r.file.Read(r.buffer[r.end:])
		if errors.Is(err, io.EOF) || (err == nil && read == 0) {
			r.atEnd = true
			continue
		}
		if err != nil {
			return nil, err
		}
		r.end += read
	}
}

// DeleteLineage removes one superseded lineage's journal, baseline and
// checkpoints. The live lineage is refused as Current.
func (s *Store) DeleteLineage(ctx context.Context, docID, lineage string) (LineageDeleteOutcome, error) {
	if docID == "" {
		return 0, argumentf("The value cannot be an empty string.")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	gate := s.gate(docID)
	gate.Lock()
	defer gate.Unlock()
	docDir := s.docDirectory(docID)
	if fileExists(filepath.Join(docDir, purgeName)) {
		return LineagePurged, nil
	}
	lineages, live, err := s.resolveLineages(docDir, docID)
	if err != nil {
		return 0, err
	}
	// Without a seeded manifest nothing says which generation is live.
	if live == nil {
		return LineageNotFound, nil
	}
	if live.Lineage == lineage {
		return LineageCurrent, nil
	}
	found := slices.IndexFunc(lineages, func(entry LineageEntry) bool { return entry.Lineage == lineage })
	if found < 0 {
		return LineageNotFound, nil
	}
	target := lineages[found]
	// Generation numbers are never reused by two publications.
	if target.Generation == live.Generation {
		return LineageCurrent, nil
	}
	// The tombstone goes first: a crash after it leaves unlisted files, never
	// a listed lineage whose files are gone.
	tombstone := target
	tombstone.Kind = LineageDeleted
	if err := appendLedgerEntry(docDir, tombstone); err != nil {
		return 0, err
	}
	if err := removeFile(filepath.Join(docDir, journalName(target.Generation, target.GenerationFence))); err != nil {
		return 0, err
	}
	if err := removeFile(filepath.Join(docDir, baselineName(target.Generation, target.GenerationFence))); err != nil {
		return 0, err
	}
	stem := "checkpoint." + strconv.FormatUint(target.Generation, 10)
	names, err := globFiles(docDir, stem)
	if err != nil {
		return 0, err
	}
	for _, name := range names {
		// The glob also takes a bare stem; the exact prefix keeps the delete
		// to this generation's checkpoints.
		if strings.HasPrefix(name, stem+".") {
			if err := removeFile(filepath.Join(docDir, name)); err != nil {
				return 0, err
			}
		}
	}
	return LineageDeletedOutcome, nil
}

// recordLineage appends a published entry unless the ledger has one. Best
// effort: history is not worth failing an open or a reset over.
func (s *Store) recordLineage(docDir, docID string, published Manifest, createdAt *time.Time) {
	if !published.Seeded || published.Generation == 0 {
		return
	}
	gate := s.gate(docID)
	gate.Lock()
	defer gate.Unlock()
	entries, err := ReadLedger(filepath.Join(docDir, LedgerFileName), s.log)
	if err == nil && !slices.ContainsFunc(entries, func(entry LineageEntry) bool {
		return entry.Kind == LineagePublished && entry.Generation == published.Generation && entry.GenerationFence == published.GenerationFence
	}) {
		err = appendLedgerEntry(docDir, LineageEntry{
			Kind: LineagePublished, Generation: published.Generation, GenerationFence: published.GenerationFence,
			Lineage: published.Lineage, Epoch: published.Epoch, Format: published.Format, CreatedAt: createdAt,
		})
	}
	if err != nil {
		s.logf("collab: could not record lineage %s of \"%s\" in %s: %v", published.Lineage, docID, LedgerFileName, err)
	}
}

// appendLedgerEntry appends one entry; the caller holds the ledger gate. A
// torn tail is padded back onto the entry grid in the same write.
func appendLedgerEntry(docDir string, entry LineageEntry) error {
	file, err := openFile(filepath.Join(docDir, LedgerFileName), os.O_WRONLY|os.O_CREATE|os.O_APPEND, false)
	if err != nil {
		return err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return err
	}
	created := info.Size() == 0
	padding := (LedgerEntrySize - info.Size()%LedgerEntrySize) % LedgerEntrySize
	_, err = file.Write(append(make([]byte, padding), EncodeLineageEntry(entry)...))
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil && created {
		err = syncDirectory(docDir)
	}
	return err
}

// Session is an exclusive, fenced handle on one document's journal
// (ICollabOperationSession). The caller serialises its use. Once another
// process takes the fence, every method fails with ErrFenceLost.
type Session struct {
	store        *Store
	docID        string
	docDir       string
	hold         *os.File
	manifestFile *os.File
	journal      *os.File
	manifest     Manifest
	index        *journalIndex
	openResult   operation.OpenResult
	closed       bool
	faulted      bool
}

// OpenResult is the document as it stood when the session opened.
func (s *Session) OpenResult() operation.OpenResult { return s.openResult }

// Close releases the fence's lock. The lock FILE stays: a session that lost
// the fence would otherwise delete a hold that is somebody else's.
func (s *Session) Close() error {
	if s.closed {
		return nil
	}
	s.closed = true
	if s.journal != nil {
		s.journal.Close()
	}
	s.manifestFile.Close()
	s.hold.Close()
	return nil
}

func (s *Session) requireFence() error {
	if s.closed {
		return ErrClosed
	}
	if s.faulted {
		return fmt.Errorf("collab: the journal for \"%s\" could not be flushed and this session can no longer say what is durable; reopen the document.", s.docID)
	}
	return requireFence(s.docDir, s.docID, s.manifest)
}

// refresh reads the durable bytes, never a memo of what this session
// appended: after an append with an unknown outcome they differ.
func (s *Session) refresh(repair bool) error {
	if s.journal == nil {
		return nil
	}
	var confirmFence func() error
	if repair {
		confirmFence = s.requireFence
	}
	_, err := scanForward(s.journal, s.index, s.docID, confirmFence)
	return err
}

func (s *Session) lookup(operationID string, digest []byte) (indexEntry, bool, bool) {
	existing, ok := s.index.byID[operationID]
	return existing, ok, ok && bytes.Equal(digest, existing.digest)
}

// FindCommitted reports what this lineage holds for an operation id, from
// the durable bytes, without writing anything.
func (s *Session) FindCommitted(ctx context.Context, operationID string, digest []byte) (operation.Lookup, error) {
	if operationID == "" {
		return operation.Lookup{}, argumentf("The value cannot be an empty string.")
	}
	if err := ctx.Err(); err != nil {
		return operation.Lookup{}, err
	}
	if err := s.requireFence(); err != nil {
		return operation.Lookup{}, err
	}
	if err := s.refresh(false); err != nil {
		return operation.Lookup{}, err
	}
	existing, ok, same := s.lookup(operationID, digest)
	switch {
	case !ok:
		return operation.Lookup{Outcome: operation.NotCommitted}, nil
	case same:
		return operation.Lookup{Outcome: operation.LookupDuplicate, Sequence: existing.sequence}, nil
	}
	return operation.Lookup{Outcome: operation.LookupConflict, Sequence: existing.sequence}, nil
}

// Append commits one operation at the next sequence, durable on return, or
// reports that its id is already committed.
func (s *Session) Append(ctx context.Context, candidate operation.Candidate) (operation.AppendResult, error) {
	// Checked once: the write and its flush are deliberately uncancellable.
	if err := ctx.Err(); err != nil {
		return operation.AppendResult{}, err
	}
	if err := s.requireFence(); err != nil {
		return operation.AppendResult{}, err
	}
	if err := s.refresh(true); err != nil {
		return operation.AppendResult{}, err
	}
	if existing, ok, same := s.lookup(candidate.OperationID, candidate.Digest); ok {
		outcome := operation.AppendConflict
		if same {
			outcome = operation.AppendDuplicate
		}
		return operation.AppendResult{Outcome: outcome, Sequence: existing.sequence}, nil
	}
	if !s.manifest.Seeded || s.journal == nil {
		return operation.AppendResult{}, &InvalidOperationError{Message: fmt.Sprintf("collab: \"%s\" was never seeded; reset it first.", s.docID)}
	}
	if int64(len(candidate.Update)) > s.store.maxUpdateBytes {
		return operation.AppendResult{}, outOfRangef("collab: the update exceeds the configured %d-byte limit.", s.store.maxUpdateBytes)
	}
	sequence := s.index.durableThrough + 1
	encoded, err := EncodeRecord(operation.Record{
		OperationID: candidate.OperationID, Sequence: sequence, CommittedAt: s.store.now(),
		ActorID: candidate.ActorID, Source: candidate.Source, Update: candidate.Update, Digest: candidate.Digest,
	})
	if err != nil {
		return operation.AppendResult{}, err
	}
	info, err := s.journal.Stat()
	if err != nil {
		return operation.AppendResult{}, err
	}
	lengthBefore := info.Size()
	_, err = s.journal.WriteAt(encoded, lengthBefore)
	if err == nil {
		err = syncJournal(s.journal)
	}
	if err != nil {
		// After a failed fsync Linux marks the pages clean, so the retry
		// would read the record back and be told Duplicate for bytes no disk
		// holds. Nothing was acknowledged, so undo it.
		s.rollBack(lengthBefore)
		return operation.AppendResult{}, err
	}
	// Again after the flush: the check above and the write are not one step.
	if err := s.requireFence(); err != nil {
		return operation.AppendResult{}, err
	}
	s.index.byID[candidate.OperationID] = indexEntry{sequence: sequence, digest: bytes.Clone(candidate.Digest)}
	s.index.durableThrough = sequence
	s.index.scannedThrough = lengthBefore + int64(len(encoded))
	return operation.AppendResult{Outcome: operation.Committed, Sequence: sequence}, nil
}

// rollBack undoes a failed append, after re-checking the fence: if it moved,
// the cut would delete records the new holder acknowledged. When it cannot
// undo, the session stops answering.
func (s *Session) rollBack(length int64) {
	err := s.requireFence()
	if err == nil {
		err = s.journal.Truncate(length)
	}
	if err == nil {
		err = s.journal.Sync()
	}
	if err != nil {
		s.faulted = true
	}
}

func (s *Session) republish(next Manifest) error {
	if err := s.requireFence(); err != nil {
		return err
	}
	next.WriteCounter = s.manifest.WriteCounter + 1
	if err := publish(s.manifestFile, next); err != nil {
		return err
	}
	s.manifest = next
	return nil
}

// WriteCheckpoint publishes a checkpoint at a committed sequence at or above
// the published one; the published one again is a no-op. History stays.
func (s *Session) WriteCheckpoint(ctx context.Context, checkpoint operation.Checkpoint) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.requireFence(); err != nil {
		return err
	}
	if err := s.refresh(false); err != nil {
		return err
	}
	if checkpoint.Through == 0 || checkpoint.Through > s.index.durableThrough || checkpoint.Through < s.manifest.CheckpointThrough {
		return outOfRangef("a checkpoint must name a committed sequence at or above the published one")
	}
	if checkpoint.Through == s.manifest.CheckpointThrough {
		return nil
	}
	// The writing fence is in the name, so a stalled session cannot overwrite
	// the checkpoint a new holder published.
	name := checkpointName(s.manifest.Generation, checkpoint.Through, s.manifest.Fence)
	if err := WriteSealed(filepath.Join(s.docDir, name), CheckpointMagic, checkpoint.Through, checkpoint.State); err != nil {
		return err
	}
	if err := syncDirectory(s.docDir); err != nil {
		return err
	}
	next := s.manifest
	next.CheckpointThrough = checkpoint.Through
	next.CheckpointFence = s.manifest.Fence
	if err := s.republish(next); err != nil {
		return err
	}
	// Only after the publication, and only names ending in this session's
	// fence: the glob covers every fence, and another holder's checkpoint may
	// be live. Superseded generations are history and are never swept here.
	mine := "." + strconv.FormatUint(s.manifest.Fence, 10)
	stale, err := globFiles(s.docDir, "checkpoint."+strconv.FormatUint(s.manifest.Generation, 10))
	if err != nil {
		// C# lets this throw too: the publication stands, and the caller's
		// retry at the same sequence is a no-op.
		return err
	}
	for _, other := range stale {
		if other != name && strings.HasSuffix(other, mine) {
			if err := removeFile(filepath.Join(s.docDir, other)); err != nil {
				s.store.logf("collab: could not remove the superseded %s for \"%s\": %v", other, s.docID, err)
			}
		}
	}
	return nil
}

// Reset replaces the document with a new epoch, lineage and baseline; it is
// also how an unseeded document is seeded. Every name it writes carries the
// minting fence, which is what makes it safe: a stalled session writes names
// nothing references, and its publication then fails on the fence.
func (s *Session) Reset(ctx context.Context, reset operation.Reset) (operation.Head, error) {
	if err := ctx.Err(); err != nil {
		return operation.Head{}, err
	}
	if err := s.requireFence(); err != nil {
		return operation.Head{}, err
	}
	s.store.recordLineage(s.docDir, s.docID, s.manifest, nil)
	if !workingset.IsLineage(reset.Lineage) {
		return operation.Head{}, argumentf("collab: the lineage %s is not 32 lowercase-hex characters.", reset.Lineage)
	}
	if reset.Format < 1 {
		return operation.Head{}, argumentf("collab: the format %d is not a schema version.", reset.Format)
	}
	if s.manifest.Seeded && reset.Epoch <= s.manifest.Epoch {
		return operation.Head{}, outOfRangef("a reset must raise the epoch above %d", s.manifest.Epoch)
	}
	generation := s.manifest.Generation + 1
	mintedBy := s.manifest.Fence
	var frames bytes.Buffer
	for _, frame := range reset.Baseline {
		if len(frame) == 0 {
			return operation.Head{}, argumentf("collab: baseline frames must not be empty.")
		}
		workingset.AppendFrame(&frames, frame)
	}
	if err := WriteSealed(filepath.Join(s.docDir, baselineName(generation, mintedBy)), BaselineMagic, 0, frames.Bytes()); err != nil {
		return operation.Head{}, err
	}
	// Opened before the publication and swapped in only after everything that
	// can fail: a session left on the old index would answer Duplicate for
	// ids of a lineage that can never be replayed.
	swapped, err := openFile(filepath.Join(s.docDir, journalName(generation, mintedBy)), os.O_RDWR|os.O_CREATE, false)
	if err != nil {
		return operation.Head{}, err
	}
	err = s.requireFence()
	if err == nil {
		err = swapped.Truncate(0)
	}
	if err == nil {
		err = swapped.Sync()
	}
	if err == nil {
		err = syncDirectory(s.docDir)
	}
	if err == nil {
		next := s.manifest
		next.Generation = generation
		next.GenerationFence = mintedBy
		next.CheckpointFence = 0
		next.Seeded = true
		next.Format = reset.Format
		next.Epoch = reset.Epoch
		next.Lineage = reset.Lineage
		next.CheckpointThrough = 0
		err = s.republish(next)
	}
	if err != nil {
		swapped.Close()
		return operation.Head{}, err
	}
	if s.journal != nil {
		s.journal.Close()
	}
	s.journal = swapped
	s.index.clear()
	// Only after the publication: a delete that finds this entry must also
	// read a manifest naming it as current.
	now := s.store.now()
	s.store.recordLineage(s.docDir, s.docID, s.manifest, &now)
	return operation.Head{Format: reset.Format, Epoch: reset.Epoch, Lineage: reset.Lineage}, nil
}
