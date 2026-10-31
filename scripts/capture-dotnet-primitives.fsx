// Captures what .NET's IPAddress.TryParse, System.Uri and
// Uri.UnescapeDataString answer, into
// test/unit/server-conformance/fixtures/dotnet/primitives.json. The Go server
// reads it to match these parsers; DotnetPrimitivesFixtureTests recomputes it,
// so a stale capture fails C# too.
//
//   dotnet fsi scripts/capture-dotnet-primitives.fsx
//
// An IPv6 scope given by name ("%eth0") becomes that interface's index on the
// machine that parses it (if_nametoindex), so "fe80::1%eth0" prints
// "fe80::1%2" on a Linux runner and "fe80::1" on a Mac. Name scopes in
// ipInputs must be 16+ bytes: no interface can have such a name (IFNAMSIZ).
open System
open System.IO
open System.Net
open System.Text.Json
open System.Text.Json.Nodes

let root = Path.Combine(__SOURCE_DIRECTORY__, "..")
let path = Path.Combine(root, "test/unit/server-conformance/fixtures/dotnet/primitives.json")
let input = JsonNode.Parse(File.ReadAllText path).AsObject()

let ip (s: string) =
  let o = JsonObject()
  o["input"] <- JsonValue.Create s
  let ok, a = IPAddress.TryParse s
  o["ok"] <- JsonValue.Create ok
  if ok then
    o["address"] <- JsonValue.Create(a.ToString())
    o["loopback"] <- JsonValue.Create(IPAddress.IsLoopback a)
    o["any"] <- JsonValue.Create(a.Equals IPAddress.Any || a.Equals IPAddress.IPv6Any)
  o

let uri (b: string) (s: string) =
  let o = JsonObject()
  if b <> null then o["base"] <- JsonValue.Create b
  o["input"] <- JsonValue.Create s
  let ok, u = if b = null then Uri.TryCreate(s, UriKind.Absolute) else Uri.TryCreate(Uri b, s)
  o["ok"] <- JsonValue.Create ok
  if ok then
    o["scheme"] <- JsonValue.Create u.Scheme
    o["host"] <- JsonValue.Create u.Host
    o["idnHost"] <- JsonValue.Create u.IdnHost
    o["hostType"] <- JsonValue.Create(string u.HostNameType)
    o["userInfo"] <- JsonValue.Create u.UserInfo
    o["port"] <- JsonValue.Create u.Port
    o["absolutePath"] <- JsonValue.Create u.AbsolutePath
    o["query"] <- JsonValue.Create u.Query
    o["fragment"] <- JsonValue.Create u.Fragment
    o["absoluteUri"] <- JsonValue.Create u.AbsoluteUri
    o["loopback"] <- JsonValue.Create u.IsLoopback
  o

let strings (key: string) = [ for n in input[key].AsArray() -> n.GetValue<string>() ]
let output = JsonObject()
output["ipInputs"] <- input["ipInputs"].DeepClone()
output["uriInputs"] <- input["uriInputs"].DeepClone()
output["relativeInputs"] <- input["relativeInputs"].DeepClone()
output["unescapeInputs"] <- input["unescapeInputs"].DeepClone()
output["ip"] <- JsonArray([| for s in strings "ipInputs" -> ip s :> JsonNode |])
output["uri"] <- JsonArray([| for s in strings "uriInputs" -> uri null s :> JsonNode |])
output["relative"] <- JsonArray([| for p in input["relativeInputs"].AsArray() -> uri (p[0].GetValue<string>()) (p[1].GetValue<string>()) :> JsonNode |])
output["unescape"] <- JsonArray([| for s in strings "unescapeInputs" -> JsonArray(JsonValue.Create s, JsonValue.Create(Uri.UnescapeDataString s)) :> JsonNode |])
File.WriteAllText(path, output.ToJsonString(JsonSerializerOptions(WriteIndented = true)) + "\n")
