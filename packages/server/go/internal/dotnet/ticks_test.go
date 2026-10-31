package dotnet

import (
	"testing"
	"time"
)

func TestTicksRoundTripAcrossTheWholeDotnetRange(t *testing.T) {
	for _, ticks := range []int64{0, 1, 621355968000000000, 621355968000000001, 638660000001234567, MaxTicks - 1, MaxTicks} {
		if got := Ticks(TimeFromTicks(ticks)); got != ticks {
			t.Errorf("%d -> %d", ticks, got)
		}
	}
	if got := TimeFromTicks(621355968000000000); !got.Equal(time.Unix(0, 0)) {
		t.Errorf("unix epoch: %v", got)
	}
	if got := TimeFromTicks(0); got.Year() != 1 || got.Month() != 1 || got.Day() != 1 {
		t.Errorf("tick 0: %v", got)
	}
	if got := TimeFromTicks(MaxTicks); got.Year() != 9999 || got.Nanosecond() != 999999900 {
		t.Errorf("max: %v", got)
	}
	// Precision below a tick is dropped, as DateTimeOffset does.
	if got := Ticks(time.Unix(0, 199)); got != 621355968000000001 {
		t.Errorf("199 ns: %d", got)
	}
}
