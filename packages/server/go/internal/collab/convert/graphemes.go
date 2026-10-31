package convert

import (
	"sort"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// graphemeBreak is .NET's GraphemeClusterBreakType.
type graphemeBreak uint8

const (
	gbOther graphemeBreak = iota
	gbPrepend
	gbCR
	gbLF
	gbControl
	gbExtend
	gbRegionalIndicator
	gbSpacingMark
	gbL
	gbV
	gbT
	gbLV
	gbLVT
	gbZWJ
	gbExtendedPictograph
)

type graphemeRange struct {
	first, last rune
	kind        graphemeBreak
}

func graphemeBreakOf(code rune) graphemeBreak {
	at := sort.Search(len(graphemeRanges), func(i int) bool { return graphemeRanges[i].last >= code })
	if at < len(graphemeRanges) && graphemeRanges[at].first <= code {
		return graphemeRanges[at].kind
	}
	return gbOther
}

// segmenter walks scalars the way .NET's TextSegmentationUtility.Processor
// does: a lone surrogate reads as U+FFFD (Other), the end as Other.
type segmenter struct {
	text   jsjson.Str
	offset int
	size   int
	kind   graphemeBreak
}

func (s *segmenter) next() {
	s.offset += s.size
	rest := s.text[s.offset:]
	switch {
	case len(rest) == 0:
		s.size, s.kind = 0, gbOther
	case isHigh(rest[0]) && len(rest) > 1 && isLow(rest[1]):
		s.size = 2
		s.kind = graphemeBreakOf(0x10000 + (rune(rest[0])-0xD800)<<10 + rune(rest[1]) - 0xDC00)
	case isHigh(rest[0]) || isLow(rest[0]):
		s.size, s.kind = 1, gbOther
	default:
		s.size, s.kind = 1, graphemeBreakOf(rune(rest[0]))
	}
}

func isHigh(unit uint16) bool { return unit >= 0xD800 && unit <= 0xDBFF }
func isLow(unit uint16) bool  { return unit >= 0xDC00 && unit <= 0xDFFF }

// firstClusterLength is GetLengthOfFirstUtf16ExtendedGraphemeCluster: every
// UAX #29 rule but GB9c, in .NET's order.
func firstClusterLength(text jsjson.Str) int {
	s := &segmenter{text: text}
	s.next()
	for s.kind == gbPrepend {
		s.next()
	}
	if s.offset > 0 && (s.kind == gbControl || s.kind == gbCR || s.kind == gbLF) {
		return s.offset
	}
	previous := s.kind
	s.next()
	switch previous {
	case gbCR:
		if s.kind == gbLF {
			s.next()
		}
		return s.offset
	case gbControl, gbLF:
		return s.offset
	case gbL, gbLV, gbV, gbLVT, gbT:
		hangul(s, previous)
	case gbExtendedPictograph:
		for {
			for s.kind == gbExtend {
				s.next()
			}
			if s.kind != gbZWJ {
				break
			}
			s.next()
			if s.kind != gbExtendedPictograph {
				break
			}
			s.next()
		}
	case gbRegionalIndicator:
		if s.kind == gbRegionalIndicator {
			s.next()
		}
	}
	for s.kind == gbExtend || s.kind == gbZWJ || s.kind == gbSpacingMark {
		s.next()
	}
	return s.offset
}

// hangul is GB6-GB8: the goto chain of the .NET switch.
func hangul(s *segmenter, state graphemeBreak) {
	for {
		switch state {
		case gbL:
			switch s.kind {
			case gbL, gbV, gbLV, gbLVT:
				state = s.kind
				s.next()
				continue
			}
		case gbLV, gbV:
			switch s.kind {
			case gbV, gbT:
				state = s.kind
				s.next()
				continue
			}
		case gbLVT, gbT:
			if s.kind == gbT {
				s.next()
				continue
			}
		}
		return
	}
}

// textElementStarts is where StringInfo.GetTextElementEnumerator starts each element.
func textElementStarts(text jsjson.Str) []int {
	var starts []int
	for at := 0; at < len(text); {
		starts = append(starts, at)
		at += firstClusterLength(text[at:])
	}
	return starts
}
