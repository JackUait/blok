use std::collections::HashMap;
use std::hash::Hash;

/// A map that enumerates like .NET's Dictionary and HashSet: a removed slot
/// is reused last-freed-first, and enumeration walks the slots. The
/// identities frame and the awareness removal list their entries in this
/// order, so C# and Rust put the same bytes on the wire.
pub(crate) struct Ordered<K, V> {
    index: HashMap<K, usize>,
    slots: Vec<Option<(K, V)>>,
    free: Vec<usize>,
}

impl<K, V> Default for Ordered<K, V> {
    fn default() -> Self {
        Ordered {
            index: HashMap::new(),
            slots: Vec::new(),
            free: Vec::new(),
        }
    }
}

impl<K: Eq + Hash + Clone, V> Ordered<K, V> {
    pub(crate) fn get(&self, key: &K) -> Option<&V> {
        let i = *self.index.get(key)?;
        self.slots[i].as_ref().map(|(_, v)| v)
    }

    pub(crate) fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        let i = *self.index.get(key)?;
        self.slots[i].as_mut().map(|(_, v)| v)
    }

    pub(crate) fn set(&mut self, key: K, value: V) {
        if let Some(&i) = self.index.get(&key) {
            self.slots[i] = Some((key, value));
            return;
        }
        if let Some(i) = self.free.pop() {
            self.index.insert(key.clone(), i);
            self.slots[i] = Some((key, value));
            return;
        }
        self.index.insert(key.clone(), self.slots.len());
        self.slots.push(Some((key, value)));
    }

    pub(crate) fn remove(&mut self, key: &K) -> bool {
        let Some(i) = self.index.remove(key) else {
            return false;
        };
        self.slots[i] = None;
        self.free.push(i);
        true
    }

    pub(crate) fn has(&self, key: &K) -> bool {
        self.index.contains_key(key)
    }

    pub(crate) fn len(&self) -> usize {
        self.index.len()
    }

    pub(crate) fn clear(&mut self) {
        self.index.clear();
        self.slots.clear();
        self.free.clear();
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.slots.iter().flatten().map(|(k, v)| (k, v))
    }

    /// A snapshot, for loops that change the map.
    pub(crate) fn keys(&self) -> Vec<K> {
        self.iter().map(|(k, _)| k.clone()).collect()
    }
}
