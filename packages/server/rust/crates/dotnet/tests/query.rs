use blok_dotnet::query_all;

// The status codes these lists lead to are pinned against the C# host by
// collab-http-contract's "like ASP.NET" cases.
#[test]
fn query_all_reads_the_query_like_aspnet() {
    let cases: &[(&str, &[&str])] = &[
        ("group=1", &["1"]),
        ("GROUP=7", &["7"]),
        ("group=1&Group=15", &["1", "15"]),
        ("group=1;x=1", &["1;x=1"]),
        ("group=%zz", &["%zz"]),
        ("group=1%00", &["1\x00"]),
        ("group=%31+", &["1 "]),
        ("x=1&&group=", &[""]),
        ("x=1", &[]),
        ("", &[]),
    ];
    for &(raw, want) in cases {
        assert_eq!(query_all(raw, "group"), want, "query_all({raw:?})");
    }
}
