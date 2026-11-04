use crate::Id;
use crate::test_support::*;

#[test]
fn head_id_names_the_item_holding_the_value() {
    let doc = doc_with_id(7);
    let page = doc.get_map("page").unwrap();
    doc.transact(|tx| page.set(tx, "a", num(1.0))).unwrap();
    doc.transact(|tx| page.set(tx, "a", num(2.0))).unwrap();
    assert_eq!(page.head_id("a"), Some(Id::new(7, 1)));
    doc.transact(|tx| page.delete(tx, "a")).unwrap();
    assert_eq!(page.head_id("a"), None, "a deleted key still has a head");
    assert_eq!(page.head_id("b"), None, "an absent key has a head");
}
