export const NOTE_DAY_PREFIX = "NOTE#";

/**
 * A calendar day in a given timezone, as `yyyy-mm-dd`. The digest partitions notes by local
 * day, so the processor that writes the key and the digest that reads it must agree on where
 * the day breaks; that agreement lives here and nowhere else.
 */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Partition key of the day a note belongs to. */
export function noteDayPartition(date: Date, timeZone: string): string {
  return `${NOTE_DAY_PREFIX}${dayKey(date, timeZone)}`;
}

/**
 * Every day partition a window touches, oldest first. A 24 hour window almost always spans two
 * of them, which is the reason the partition is the day and not a constant.
 */
export function dayKeysBetween(from: Date, to: Date, timeZone: string): string[] {
  const keys: string[] = [];
  const step = 6 * 60 * 60 * 1000;

  for (let at = from.getTime(); at < to.getTime(); at += step) {
    const key = dayKey(new Date(at), timeZone);

    if (keys.at(-1) !== key) {
      keys.push(key);
    }
  }

  const last = dayKey(to, timeZone);

  if (keys.at(-1) !== last) {
    keys.push(last);
  }

  return keys;
}
