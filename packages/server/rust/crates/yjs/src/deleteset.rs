use std::collections::HashMap;

use blok_lib0::{Reader, Writer};

use crate::FormatError;

/// A run of deleted clocks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeleteRange {
    pub clock: u64,
    pub length: u64,
}

impl DeleteRange {
    pub fn new(clock: u64, length: u64) -> DeleteRange {
        DeleteRange { clock, length }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DeleteClient {
    pub client: u64,
    pub ranges: Vec<DeleteRange>,
}

/// Per client, a list of clock ranges. Clients keep their insertion order,
/// which decides the order deletions are applied in.
#[derive(Clone, Debug, Default)]
pub struct DeleteSet {
    pub(crate) clients: Vec<DeleteClient>,
    index: HashMap<u64, usize>,
}

impl DeleteSet {
    pub fn new() -> DeleteSet {
        DeleteSet::default()
    }

    pub fn is_empty(&self) -> bool {
        self.clients.is_empty()
    }

    /// The number of clients.
    pub fn len(&self) -> usize {
        self.clients.len()
    }

    /// A client's ranges, empty when unlisted.
    pub fn ranges(&self, client: u64) -> &[DeleteRange] {
        match self.index.get(&client) {
            Some(&at) => &self.clients[at].ranges,
            None => &[],
        }
    }

    /// The listed clients in insertion order.
    pub fn clients(&self) -> Vec<u64> {
        self.clients.iter().map(|entry| entry.client).collect()
    }

    fn entry(&mut self, client: u64) -> &mut DeleteClient {
        let at = match self.index.get(&client) {
            Some(&at) => at,
            None => {
                self.index.insert(client, self.clients.len());
                self.clients.push(DeleteClient {
                    client,
                    ranges: Vec::new(),
                });
                self.clients.len() - 1
            }
        };
        &mut self.clients[at]
    }

    pub fn add(&mut self, client: u64, clock: u64, length: u64) {
        self.entry(client)
            .ranges
            .push(DeleteRange::new(clock, length));
    }

    /// Clients in descending id order, each clock absolute.
    pub(crate) fn write(&self, w: &mut Writer) {
        w.write_var_uint(self.clients.len() as u64);
        let mut sorted: Vec<&DeleteClient> = self.clients.iter().collect();
        sorted.sort_by_key(|entry| std::cmp::Reverse(entry.client));
        for entry in sorted {
            w.write_var_uint(entry.client);
            w.write_var_uint(entry.ranges.len() as u64);
            for r in &entry.ranges {
                w.write_var_uint(r.clock);
                w.write_var_uint(r.length);
            }
        }
    }

    /// Sorts each client's ranges by clock and folds touching or
    /// overlapping ones together, in place.
    pub(crate) fn sort_and_merge(&mut self) {
        for entry in &mut self.clients {
            let ranges = &mut entry.ranges;
            ranges.sort_by_key(|r| r.clock);
            let mut write = 1;
            for read in 1..ranges.len() {
                let (left, right) = (ranges[write - 1], ranges[read]);
                if left.clock + left.length >= right.clock {
                    ranges[write - 1] = DeleteRange::new(
                        left.clock,
                        left.length.max(right.clock + right.length - left.clock),
                    );
                    continue;
                }
                ranges[write] = right;
                write += 1;
            }
            if ranges.len() > write {
                ranges.truncate(write);
            }
        }
    }
}

/// Drops a client with no ranges; a client listed twice appends (unlike
/// struct groups, which are refused).
pub(crate) fn read_delete_set(r: &mut Reader<'_>) -> Result<DeleteSet, FormatError> {
    let mut set = DeleteSet::new();
    let clients = r.read_var_uint()?;
    for _ in 0..clients {
        let client = r.read_var_uint()?;
        let ranges = r.read_var_uint()?;
        if ranges == 0 {
            continue;
        }
        for _ in 0..ranges {
            let clock = r.read_var_uint()?;
            let length = r.read_var_uint()?;
            set.add(client, clock, length);
        }
    }
    Ok(set)
}

pub(crate) fn copy_ranges(source: &DeleteSet, target: &mut DeleteSet) {
    for entry in &source.clients {
        for r in &entry.ranges {
            target.add(entry.client, r.clock, r.length);
        }
    }
}

pub(crate) fn merge_delete_sets(
    left: Option<DeleteSet>,
    right: Option<DeleteSet>,
) -> Option<DeleteSet> {
    match (left, right) {
        (None, right) => right,
        (left, None) => left,
        (Some(left), Some(right)) => {
            let mut merged = DeleteSet::new();
            copy_ranges(&left, &mut merged);
            copy_ranges(&right, &mut merged);
            merged.sort_and_merge();
            Some(merged)
        }
    }
}
