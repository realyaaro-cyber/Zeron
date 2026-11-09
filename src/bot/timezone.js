// Time zone helpers. Each server has its own time zone; announcements are scheduled in it.

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (error) {
    return false;
  }
}

// Offset of a time zone from UTC, in milliseconds, at the given instant.
function offsetMs(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ts));
  const get = type => Number(parts.find(part => part.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - (ts - (ts % 1000));
}

// "2026-10-30" + "09:30" in a time zone -> the real UTC instant (ms).
function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

// Local calendar date (YYYY-MM-DD) of an instant in a time zone.
function localDate(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ts));
  const get = type => parts.find(part => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000;
}

// Next time (ms, UTC) an announcement should run after afterMs, or null if it never will.
function nextOccurrence(startDate, timeStr, repeat, tz, afterMs) {
  if (repeat === 'once') {
    const at = zonedToUtc(startDate, timeStr, tz);
    return at > afterMs ? at : null;
  }
  const step = repeat === 'weekly' ? 7 : 1;
  const today = localDate(afterMs, tz);
  for (let i = 0; i <= 8; i++) {
    const day = addDays(today, i);
    const diff = daysBetween(startDate, day);
    if (diff < 0 || diff % step !== 0) continue;
    const at = zonedToUtc(day, timeStr, tz);
    if (at > afterMs) return at;
  }
  return null;
}

const COMMON_TIMEZONES = [
  'UTC', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Dubai', 'Asia/Singapore',
  'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'America/Mexico_City',
  'Australia/Sydney', 'Pacific/Auckland'
];

module.exports = { isValidTimezone, zonedToUtc, nextOccurrence, COMMON_TIMEZONES };
