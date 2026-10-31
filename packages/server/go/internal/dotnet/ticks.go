package dotnet

import "time"

// MaxTicks is DateTimeOffset.MaxValue.Ticks (9999-12-31T23:59:59.9999999Z).
const MaxTicks int64 = 3155378975999999999

// unixTicks is the tick count of 1970-01-01T00:00:00Z.
const unixTicks int64 = 621355968000000000

// TimeFromTicks reads .NET UTC ticks: 100 ns units since 0001-01-01. It avoids
// time.Duration, which overflows after about 292 years.
func TimeFromTicks(ticks int64) time.Time {
	since := ticks - unixTicks
	seconds := since / 10_000_000
	rest := since % 10_000_000
	if rest < 0 {
		seconds--
		rest += 10_000_000
	}
	return time.Unix(seconds, rest*100).UTC()
}

// Ticks is DateTimeOffset.UtcTicks: precision below 100 ns is dropped.
func Ticks(t time.Time) int64 {
	return t.Unix()*10_000_000 + int64(t.Nanosecond()/100) + unixTicks
}
