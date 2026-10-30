// Captures what System.Text.Json answers for the cases on stdin, for
// scripts/generate-jsjson-fixtures.mjs. Run it through that script.
// "canonical" mirrors CollabEditOps.WriteCanonicalNode; JsJsonFixtureTests
// checks the mirror against the real code.
open System
open System.IO
open System.Text
open System.Text.Json
open System.Text.Json.Nodes

let fromUnits (hex: string) =
  String [| for i in 0 .. 4 .. hex.Length - 1 -> char (Convert.ToUInt16(hex.Substring(i, 4), 16)) |]

let writeKind (e: exn) =
  match e with
  | :? InvalidOperationException as i when i.Message.Contains("surrogate") -> "loneSurrogate"
  | :? InvalidOperationException as i when i.Message.Contains("invalid UTF-8") -> "invalidUtf8"
  | :? ArgumentException as a when a.Message.Contains("same key") -> "duplicate"
  | _ -> "other:" + e.GetType().Name + ": " + e.Message

let parseKind (e: exn) =
  match e with
  | :? JsonException as j when j.Message.Contains("maximum configured depth") -> "depth"
  | :? JsonException as j when j.Message.StartsWith("Duplicate property") -> "duplicate"
  | :? JsonException -> "invalid"
  | _ -> writeKind e

let rec canonical (node: JsonNode) (writer: Utf8JsonWriter) =
  match node with
  | null -> writer.WriteNullValue()
  | :? JsonObject as map ->
    writer.WriteStartObject()
    for entry in map |> Seq.sortWith (fun a b -> String.CompareOrdinal(a.Key, b.Key)) do
      writer.WritePropertyName(entry.Key)
      canonical entry.Value writer
    writer.WriteEndObject()
  | :? JsonArray as items ->
    writer.WriteStartArray()
    for item in items do canonical item writer
    writer.WriteEndArray()
  | _ -> node.WriteTo(writer)

let outcome (f: unit -> string) (kind: exn -> string) : JsonNode =
  try JsonValue.Create(f()) with e -> JsonObject([ Collections.Generic.KeyValuePair("error", JsonValue.Create(kind e) :> JsonNode) ])

let input = JsonNode.Parse(Console.In.ReadToEnd())

for case in input["documents"].AsArray() do
  let bytes =
    match case["text"] with
    | null -> Convert.FromHexString(case["hex"].GetValue<string>())
    | text -> Encoding.UTF8.GetBytes(text.GetValue<string>())
  let options =
    JsonDocumentOptions(
      MaxDepth = case["maxDepth"].GetValue<int>(),
      AllowDuplicateProperties = not (case["refuseDuplicates"].GetValue<bool>()))
  let parsed =
    try Ok(JsonNode.Parse(ReadOnlySpan<byte>(bytes), Nullable(), options)) with e -> Error(parseKind e)
  match parsed with
  | Error kind -> case["parse"] <- JsonValue.Create(kind)
  | Ok node ->
    case["parse"] <- JsonValue.Create("ok")
    case["write"] <- outcome (fun () -> match node with null -> "null" | n -> n.ToJsonString()) writeKind
    case["canonical"] <- outcome (fun () ->
      use buffer = new MemoryStream()
      use writer = new Utf8JsonWriter(buffer)
      canonical node writer
      writer.Flush()
      Encoding.UTF8.GetString(buffer.ToArray())) writeKind

for case in input["strings"].AsArray() do
  let text = fromUnits (case["units"].GetValue<string>())
  case["json"] <- outcome (fun () -> JsonValue.Create(text).ToJsonString()) writeKind

Console.Out.Write(input.ToJsonString())
