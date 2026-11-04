use crate::graphemes_table::GRAPHEME_RANGES;

/// .NET's GraphemeClusterBreakType.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GraphemeBreak {
    Other,
    Prepend,
    Cr,
    Lf,
    Control,
    Extend,
    RegionalIndicator,
    SpacingMark,
    L,
    V,
    T,
    Lv,
    Lvt,
    Zwj,
    ExtendedPictograph,
}

use GraphemeBreak as G;

fn grapheme_break_of(code: u32) -> G {
    let at = GRAPHEME_RANGES.partition_point(|range| range.1 < code);
    match GRAPHEME_RANGES.get(at) {
        Some(&(first, _, kind)) if first <= code => kind,
        _ => G::Other,
    }
}

/// Walks scalars the way .NET's TextSegmentationUtility.Processor does: a
/// lone surrogate reads as U+FFFD (Other), the end as Other.
struct Segmenter<'a> {
    text: &'a [u16],
    offset: usize,
    size: usize,
    kind: G,
}

impl Segmenter<'_> {
    fn next(&mut self) {
        self.offset += self.size;
        let rest = &self.text[self.offset..];
        (self.size, self.kind) = match rest {
            [] => (0, G::Other),
            [high, low, ..] if is_high(*high) && is_low(*low) => (
                2,
                grapheme_break_of(
                    0x10000 + ((u32::from(*high) - 0xD800) << 10) + u32::from(*low) - 0xDC00,
                ),
            ),
            [unit, ..] if is_high(*unit) || is_low(*unit) => (1, G::Other),
            [unit, ..] => (1, grapheme_break_of(u32::from(*unit))),
        };
    }
}

pub(crate) fn is_high(unit: u16) -> bool {
    (0xD800..=0xDBFF).contains(&unit)
}

pub(crate) fn is_low(unit: u16) -> bool {
    (0xDC00..=0xDFFF).contains(&unit)
}

/// GetLengthOfFirstUtf16ExtendedGraphemeCluster: every UAX #29 rule but
/// GB9c, in .NET's order.
fn first_cluster_length(text: &[u16]) -> usize {
    let mut s = Segmenter {
        text,
        offset: 0,
        size: 0,
        kind: G::Other,
    };
    s.next();
    while s.kind == G::Prepend {
        s.next();
    }
    if s.offset > 0 && matches!(s.kind, G::Control | G::Cr | G::Lf) {
        return s.offset;
    }
    let previous = s.kind;
    s.next();
    match previous {
        G::Cr => {
            if s.kind == G::Lf {
                s.next();
            }
            return s.offset;
        }
        G::Control | G::Lf => return s.offset,
        G::L | G::Lv | G::V | G::Lvt | G::T => hangul(&mut s, previous),
        G::ExtendedPictograph => loop {
            while s.kind == G::Extend {
                s.next();
            }
            if s.kind != G::Zwj {
                break;
            }
            s.next();
            if s.kind != G::ExtendedPictograph {
                break;
            }
            s.next();
        },
        G::RegionalIndicator if s.kind == G::RegionalIndicator => s.next(),
        _ => {}
    }
    while matches!(s.kind, G::Extend | G::Zwj | G::SpacingMark) {
        s.next();
    }
    s.offset
}

/// GB6-GB8: the goto chain of the .NET switch.
fn hangul(s: &mut Segmenter<'_>, mut state: G) {
    loop {
        match (state, s.kind) {
            (G::L, G::L | G::V | G::Lv | G::Lvt) | (G::Lv | G::V, G::V | G::T) => {
                state = s.kind;
                s.next();
            }
            (G::Lvt | G::T, G::T) => s.next(),
            _ => return,
        }
    }
}

/// Where StringInfo.GetTextElementEnumerator starts each element.
pub(crate) fn text_element_starts(text: &[u16]) -> Vec<usize> {
    let mut starts = Vec::new();
    let mut at = 0;
    while at < text.len() {
        starts.push(at);
        at += first_cluster_length(&text[at..]);
    }
    starts
}
