use blok_jsjson::{Object, Str, Value};

use crate::{FormatError, Reader, Result, Writer};

/// Caps Any nesting on read. C# also refuses earlier when its stack probe
/// fails. Reading, writing and dropping use no recursion here, so a peer's
/// depth cannot overflow a worker's stack.
pub const MAX_ANY_DEPTH: usize = 4096;

const TAG_UINT8_ARRAY: u8 = 116;
const TAG_ARRAY: u8 = 117;
const TAG_OBJECT: u8 = 118;
const TAG_STRING: u8 = 119;
const TAG_TRUE: u8 = 120;
const TAG_FALSE: u8 = 121;
const TAG_BIG_INT: u8 = 122;
const TAG_FLOAT64: u8 = 123;
const TAG_FLOAT32: u8 = 124;
const TAG_INTEGER: u8 = 125;
const TAG_NULL: u8 = 126;
const TAG_UNDEFINED: u8 = 127;

/// Tag 125 covers integers up to this magnitude; larger ones are floats.
const MAX_TAGGED_INTEGER: f64 = 0x7fffffff as f64;

enum Open {
    Array(Vec<Value>, u64),
    Object(Object, u64, Option<Str>),
}

impl Open {
    fn remaining(&self) -> u64 {
        match self {
            Open::Array(_, remaining) | Open::Object(_, remaining, _) => *remaining,
        }
    }

    fn close(self) -> Value {
        match self {
            Open::Array(items, _) => Value::Array(items),
            Open::Object(object, _, _) => Value::Object(object),
        }
    }

    fn add(&mut self, value: Value) {
        match self {
            Open::Array(items, remaining) => {
                items.push(value);
                *remaining -= 1;
            }
            Open::Object(object, remaining, key) => {
                object.set(key.take().expect("key read before value"), value);
                *remaining -= 1;
            }
        }
    }
}

/// Reads one Any value.
pub fn read_any(r: &mut Reader<'_>) -> Result<Value> {
    // The open arrays and objects; the last one is at depth len-1, so a
    // child of it is refused once len passes MAX_ANY_DEPTH.
    let mut stack: Vec<Open> = Vec::new();
    loop {
        let mut done = read_one(r, &mut stack)?;
        loop {
            if let Some(value) = done.take() {
                match stack.last_mut() {
                    None => return Ok(value),
                    Some(open) => open.add(value),
                }
            }
            let open = stack.last_mut().expect("an open container");
            if open.remaining() == 0 {
                done = stack.pop().map(Open::close);
                continue;
            }
            if let Open::Object(_, _, key) = open {
                *key = Some(r.read_var_string()?);
            }
            if stack.len() > MAX_ANY_DEPTH {
                return Err(FormatError::new(format!(
                    "lib0: the Any value at {} nests past {MAX_ANY_DEPTH} levels.",
                    r.pos()
                )));
            }
            break;
        }
    }
}

/// Reads a tag and its scalar, or opens a container on `stack` (None).
fn read_one(r: &mut Reader<'_>, stack: &mut Vec<Open>) -> Result<Option<Value>> {
    let tag = r.read_uint8()?;
    let value = match tag {
        TAG_UNDEFINED => Value::Undefined,
        TAG_NULL => Value::Null,
        TAG_INTEGER => Value::Number(r.read_var_int()?),
        TAG_FLOAT32 => Value::Number(f64::from(r.read_float32()?)),
        TAG_FLOAT64 => Value::Number(r.read_float64()?),
        TAG_BIG_INT => Value::BigInt(r.read_big_int64()?),
        TAG_FALSE => Value::Bool(false),
        TAG_TRUE => Value::Bool(true),
        TAG_STRING => Value::String(r.read_var_string()?),
        TAG_OBJECT => {
            let count = r.read_var_uint()?;
            stack.push(Open::Object(Object::new(), count, None));
            return Ok(None);
        }
        TAG_ARRAY => {
            // Never preallocate from the wire's count.
            let count = r.read_var_uint()?;
            stack.push(Open::Array(Vec::new(), count));
            return Ok(None);
        }
        TAG_UINT8_ARRAY => Value::Bytes(r.read_var_bytes()?.to_vec()),
        _ => {
            return Err(FormatError::new(format!(
                "lib0: {tag} at {} is not an Any tag.",
                r.pos() - 1
            )));
        }
    };
    Ok(Some(value))
}

enum Step<'a> {
    Value(&'a Value),
    Key(&'a Str),
}

/// Writes one Any value.
pub fn write_any(w: &mut Writer, value: &Value) {
    let mut todo = vec![Step::Value(value)];
    while let Some(step) = todo.pop() {
        let value = match step {
            Step::Key(key) => {
                w.write_var_string(key);
                continue;
            }
            Step::Value(value) => value,
        };
        match value {
            Value::Null => w.write_uint8(TAG_NULL),
            Value::String(s) => {
                w.write_uint8(TAG_STRING);
                w.write_var_string(s);
            }
            Value::Bool(true) => w.write_uint8(TAG_TRUE),
            Value::Bool(false) => w.write_uint8(TAG_FALSE),
            Value::Number(number) => write_number(w, *number),
            Value::BigInt(n) => {
                w.write_uint8(TAG_BIG_INT);
                w.write_big_int64(*n);
            }
            Value::Bytes(b) => {
                w.write_uint8(TAG_UINT8_ARRAY);
                w.write_var_bytes(b);
            }
            Value::Object(object) => {
                w.write_uint8(TAG_OBJECT);
                w.write_var_uint(object.len() as u64);
                for member in object.members().iter().rev() {
                    todo.push(Step::Value(&member.value));
                    todo.push(Step::Key(&member.key));
                }
            }
            Value::Array(items) => {
                w.write_uint8(TAG_ARRAY);
                w.write_var_uint(items.len() as u64);
                todo.extend(items.iter().rev().map(Step::Value));
            }
            Value::Undefined => w.write_uint8(TAG_UNDEFINED),
        }
    }
}

/// lib0's writeAny dispatch: integer, else float32 if it round-trips, else
/// float64.
fn write_number(w: &mut Writer, number: f64) {
    if number.is_nan() {
        w.write_uint8(TAG_FLOAT64);
        w.write_float64(blok_jsjson::nan());
        return;
    }
    if number == number.trunc() && number.abs() <= MAX_TAGGED_INTEGER {
        w.write_uint8(TAG_INTEGER);
        w.write_var_int(number);
        return;
    }
    // Infinity round-trips through f32, so it lands here, as in lib0.
    if f64::from(number as f32) == number {
        w.write_uint8(TAG_FLOAT32);
        w.write_float32(number as f32);
        return;
    }
    w.write_uint8(TAG_FLOAT64);
    w.write_float64(number);
}
