package room

import (
	"time"

	"github.com/JackUait/blok/packages/server/go/v2/internal/dotnet"
)

// HistoryPoint is CollabHistoryPoint: a record, or a lineage baseline
// (sequence 0).
type HistoryPoint struct {
	Lineage     string
	Sequence    uint64
	CommittedAt *time.Time
}

// RangeSelection is CollabRangeSelection. Records are newest first.
type RangeSelection struct {
	Status    HistoryStatus
	Records   []HistoryPoint
	Truncated bool
}

// DefaultHistoryRange is the changes-by-time route's default range.
const DefaultHistoryRange = 24 * time.Hour

const (
	ticksPerSecond = int64(10_000_000)
	ticksPerDay    = 86_400 * ticksPerSecond
	maxTicks       = int64(3_155_378_975_999_999_999)
)

// ParseHistoryTime is CollabHistoryTime.TryParse:
// YYYY-MM-DDTHH:MM:SS[.f{1,7}](Z|±HH:MM), nothing else. The offset is
// required, and seven fraction digits are .NET's tick.
func ParseHistoryTime(s string) (time.Time, bool) {
	if len(s) < 20 {
		return time.Time{}, false
	}
	digits := func(start, count int) int {
		value := 0
		for i := start; i < start+count; i++ {
			if s[i] < '0' || s[i] > '9' {
				return -1
			}
			value = value*10 + int(s[i]-'0')
		}
		return value
	}
	if s[4] != '-' || s[7] != '-' || s[10] != 'T' || s[13] != ':' || s[16] != ':' {
		return time.Time{}, false
	}
	year, month, day := digits(0, 4), digits(5, 2), digits(8, 2)
	hour, minute, second := digits(11, 2), digits(14, 2), digits(17, 2)
	if year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
		hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 {
		return time.Time{}, false
	}
	index := 19
	fraction := int64(0)
	if s[index] == '.' {
		index++
		start := index
		for index < len(s) && s[index] >= '0' && s[index] <= '9' {
			index++
		}
		count := index - start
		if count < 1 || count > 7 {
			return time.Time{}, false
		}
		fraction = int64(digits(start, count))
		for pad := count; pad < 7; pad++ {
			fraction *= 10
		}
	}
	var offset int64
	switch {
	case index == len(s)-1 && s[index] == 'Z':
	case index == len(s)-6 && (s[index] == '+' || s[index] == '-') && s[index+3] == ':':
		hours, minutes := digits(index+1, 2), digits(index+4, 2)
		if hours < 0 || hours > 14 || minutes < 0 || minutes > 59 || (hours == 14 && minutes > 0) {
			return time.Time{}, false
		}
		offset = (int64(hours)*60 + int64(minutes)) * 60 * ticksPerSecond
		if s[index] == '-' {
			offset = -offset
		}
	default:
		return time.Time{}, false
	}
	ticks := daysBefore(year, month, day)*ticksPerDay +
		((int64(hour)*60+int64(minute))*60+int64(second))*ticksPerSecond + fraction - offset
	if ticks < 0 || ticks > maxTicks {
		return time.Time{}, false
	}
	return dotnet.TimeFromTicks(ticks), true
}

func isLeap(year int) bool { return year%4 == 0 && (year%100 != 0 || year%400 == 0) }

func daysInMonth(year, month int) int {
	switch month {
	case 2:
		if isLeap(year) {
			return 29
		}
		return 28
	case 4, 6, 9, 11:
		return 30
	}
	return 31
}

// daysBefore counts days from 0001-01-01 to the date, as DateTime does.
func daysBefore(year, month, day int) int64 {
	y := int64(year - 1)
	days := y*365 + y/4 - y/100 + y/400
	for m := 1; m < month; m++ {
		days += int64(daysInMonth(year, m))
	}
	return days + int64(day-1)
}

// ResolveAt is CollabHistoryTime.ResolveAt: the newest point at or before
// at. Points are every record and every baseline with a created-at. Equal
// times: the later lineage wins, then the higher sequence. Nil when none is
// that old.
func ResolveAt(lineagesOldestFirst []LineageHeaders, at time.Time) *HistoryPoint {
	var best *HistoryPoint
	bestLineage := -1
	consider := func(lineage int, name string, sequence uint64, when time.Time) {
		if when.After(at) {
			return
		}
		if best != nil {
			b := *best.CommittedAt
			if when.Before(b) || (when.Equal(b) && (lineage < bestLineage || (lineage == bestLineage && sequence < best.Sequence))) {
				return
			}
		}
		w := when
		best = &HistoryPoint{Lineage: name, Sequence: sequence, CommittedAt: &w}
		bestLineage = lineage
	}
	for i, entry := range lineagesOldestFirst {
		if entry.Lineage.CreatedAt != nil {
			consider(i, entry.Lineage.Lineage, 0, *entry.Lineage.CreatedAt)
		}
		for _, header := range entry.Headers {
			consider(i, entry.Lineage.Lineage, header.Sequence, header.CommittedAt)
		}
	}
	return best
}

// SelectRange is CollabHistoryTime.SelectRange: the records committed in
// [from, to), older than before when given, newest first by lineage then
// sequence, at most maxRecords.
func SelectRange(lineagesOldestFirst []LineageHeaders, from, to time.Time, before *HistoryPoint, maxRecords int) RangeSelection {
	beforeLineage, beforeSequence := len(lineagesOldestFirst), ^uint64(0)
	if before != nil {
		beforeLineage = -1
		// Lineage ids are unique; if two ever share one, the newest wins.
		for i := len(lineagesOldestFirst) - 1; i >= 0; i-- {
			if lineagesOldestFirst[i].Lineage.Lineage == before.Lineage {
				beforeLineage = i
				break
			}
		}
		if beforeLineage < 0 {
			return RangeSelection{Status: HistoryNotFound}
		}
		beforeSequence = before.Sequence
	}
	picked := []HistoryPoint{}
	for i := min(beforeLineage, len(lineagesOldestFirst)-1); i >= 0; i-- {
		entry := lineagesOldestFirst[i]
		for r := len(entry.Headers) - 1; r >= 0; r-- {
			header := entry.Headers[r]
			if (i == beforeLineage && header.Sequence >= beforeSequence) ||
				header.CommittedAt.Before(from) || !header.CommittedAt.Before(to) {
				continue
			}
			if len(picked) == maxRecords {
				return RangeSelection{Status: HistoryReady, Records: picked, Truncated: true}
			}
			committed := header.CommittedAt
			picked = append(picked, HistoryPoint{Lineage: entry.Lineage.Lineage, Sequence: header.Sequence, CommittedAt: &committed})
		}
	}
	return RangeSelection{Status: HistoryReady, Records: picked}
}
