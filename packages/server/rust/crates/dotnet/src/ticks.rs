use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// DateTimeOffset.MaxValue.Ticks (9999-12-31T23:59:59.9999999Z).
pub const MAX_TICKS: i64 = 3155378975999999999;

/// The tick count of 1970-01-01T00:00:00Z.
const UNIX_TICKS: i64 = 621355968000000000;

/// SystemTime at a signed count of seconds and nanoseconds from the epoch.
pub(crate) fn from_unix(seconds: i64, nanos: u32) -> SystemTime {
    if seconds >= 0 {
        UNIX_EPOCH + Duration::new(seconds as u64, nanos)
    } else {
        UNIX_EPOCH - Duration::from_secs(seconds.unsigned_abs())
            + Duration::from_nanos(u64::from(nanos))
    }
}

/// Signed nanoseconds from the epoch.
pub(crate) fn unix_nanos(t: SystemTime) -> i128 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_nanos() as i128,
        Err(before) => -(before.duration().as_nanos() as i128),
    }
}

/// Reads .NET UTC ticks: 100 ns units since 0001-01-01.
pub fn time_from_ticks(ticks: i64) -> SystemTime {
    let since = ticks - UNIX_TICKS;
    let seconds = since.div_euclid(10_000_000);
    let rest = since.rem_euclid(10_000_000);
    from_unix(seconds, (rest * 100) as u32)
}

/// DateTimeOffset.UtcTicks: precision below 100 ns is dropped (floored,
/// also before the epoch).
pub fn ticks(t: SystemTime) -> i64 {
    unix_nanos(t).div_euclid(100) as i64 + UNIX_TICKS
}

/// Days since 1970-01-01 of a proleptic Gregorian date.
pub(crate) fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

#[cfg(test)]
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod ticks_test {
    use super::*;

    fn date(t: SystemTime) -> (i64, u32, u32, u32) {
        let nanos = unix_nanos(t);
        let days = nanos.div_euclid(86_400_000_000_000) as i64;
        let (y, m, d) = civil_from_days(days);
        (y, m, d, nanos.rem_euclid(1_000_000_000) as u32)
    }

    #[test]
    fn ticks_round_trip_across_the_whole_dotnet_range() {
        for t in [
            0,
            1,
            621355968000000000,
            621355968000000001,
            638660000001234567,
            MAX_TICKS - 1,
            MAX_TICKS,
        ] {
            assert_eq!(ticks(time_from_ticks(t)), t, "{t}");
        }
        assert_eq!(time_from_ticks(621355968000000000), UNIX_EPOCH);
        let (y, m, d, _) = date(time_from_ticks(0));
        assert_eq!((y, m, d), (1, 1, 1), "tick 0");
        let (y, _, _, nanos) = date(time_from_ticks(MAX_TICKS));
        assert_eq!((y, nanos), (9999, 999999900), "max");
        // Precision below a tick is dropped, as DateTimeOffset does.
        assert_eq!(ticks(from_unix(0, 199)), 621355968000000001, "199 ns");
    }

    #[test]
    fn ticks_floor_before_the_epoch() {
        assert_eq!(ticks(from_unix(-1, 999_999_950)), UNIX_TICKS - 1);
        assert_eq!(days_from_civil(1, 1, 1), -719162);
        assert_eq!(civil_from_days(-719162), (1, 1, 1));
    }
}
