use crate::ordered::Ordered;

// The expected orders were printed by .NET 10's Dictionary<ulong,int> and
// HashSet<string>: a removed slot is reused last-freed-first, and
// enumeration walks slots.
#[test]
fn enumeration_follows_dotnet_slot_reuse() {
    let mut d: Ordered<u64, i32> = Ordered::default();
    let keys = |d: &Ordered<u64, i32>| d.keys();
    for k in [1, 2, 3, 4, 5] {
        d.set(k, 0);
    }
    assert_eq!(keys(&d), [1, 2, 3, 4, 5], "a");
    d.remove(&2);
    d.remove(&4);
    assert_eq!(keys(&d), [1, 3, 5], "b");
    d.set(6, 0);
    assert_eq!(keys(&d), [1, 3, 6, 5], "c");
    d.set(7, 0);
    assert_eq!(keys(&d), [1, 7, 3, 6, 5], "d");
    d.set(8, 0);
    d.set(3, 9);
    assert_eq!(keys(&d), [1, 7, 3, 6, 5, 8], "f");
    d.remove(&1);
    d.remove(&6);
    d.remove(&5);
    d.set(9, 0);
    d.set(10, 0);
    assert_eq!(keys(&d), [7, 3, 10, 9, 8], "g");
    d.clear();
    d.set(11, 0);
    assert_eq!(keys(&d), [11], "h");

    let mut s: Ordered<String, ()> = Ordered::default();
    for k in ["a", "b", "c", "d"] {
        s.set(k.to_owned(), ());
    }
    s.remove(&"b".to_owned());
    s.remove(&"c".to_owned());
    for k in ["e", "f", "g"] {
        s.set(k.to_owned(), ());
    }
    assert_eq!(s.keys(), ["a", "f", "e", "d", "g"]);
}
