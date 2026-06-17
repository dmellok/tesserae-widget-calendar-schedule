# Calendar, Schedule

A [Tesserae](https://github.com/dmellok/tesserae) widget that paints a Google-Calendar-style agenda view: upcoming events grouped by day, with date headers, all-day events at the top of each day, and per-feed colour dots.

Reads from the same `calendar_core` feeds the other calendar_* widgets use. Drop in alongside `calendar_day` / `calendar_week` / `calendar_month`; pick which feeds to include per cell.

## Install

Settings, Widgets, Browse community widgets, search "Calendar Schedule", Install. Restart Tesserae when prompted.

Make sure you have at least one feed configured in **Widgets → Calendar Feeds** (provided by `calendar_core`, ships bundled).

## Cell options

- **Days to show**: today only, 3 days, 5 days, a week, or two weeks.
- **Feed IDs**: restrict to specific feeds (comma-separated). Blank includes every enabled feed.
- **Show event locations**: toggles the lighter-grey location text after the title.
- **Show per-feed colour dot**: turn off for pure typography (useful on 1-bit panels).
- **Time format**: Auto, 24-hour, or 12-hour.
- **Skip days with no events**: when off, every day in the window renders even if empty.
- **Max events per day**: cap each day's row count (0 = show all).

## Layout

```
1  OCT, FRI    • All day    PTO Book Fair
               • All day    Day A (Week 4)
               • 6 – 7pm    PTO Fall Family Night

2  OCT, SAT    • All day    PTO Book Fair

4  OCT, MON    • All day    PTO Book Fair
               • All day    Week of Respect (WHS theme days)
               • All day    Day B
               • 3:45 – 4:45pm  Voluntary PD: Carolina Science Online Review
```

Each day row has a big day number + day-of-week chip on the left, then rows of `time | dot | title (location)` on the right. All-day events are grouped at the top of each day; timed events follow in chronological order.

The first day in the window is highlighted as "today" (accent-coloured day number).

## Timezone handling

Day grouping happens server-side using your **Settings → Timezone** setting, so an event at 23:00 UTC on Wed renders under Thu's bucket for a user in Europe/Berlin (UTC+2). Time strings ("3:45 – 4:45pm") are formatted client-side, also in that zone (Tesserae 0.44.10+ forwards the setting to the rendering Chromium so the device frame matches the preview).

## What you need

- `calendar_core` plugin installed (ships bundled with Tesserae).
- At least one iCal feed configured in **Widgets → Calendar Feeds**. Google Calendar / iCloud / Outlook all expose private iCal URLs you can paste.
- Tesserae's renderer reaches the iCal URL(s) you configured. The widget's network access goes through `calendar_core`'s `needs_network: true` block.

## Caveats

- Agenda layouts are text-dense by nature. At very small cell sizes (xs / sm), expect long event titles to truncate with an ellipsis and locations to be hidden. Increase `max_events_per_day` or pick a larger cell if you find it crowded.
- The screenshot reference uses Google's design language; the widget aims for a similar feel but inherits Tesserae's theme tokens (`--text-primary`, `--surface`, `--accent`) so it slots into whatever theme your dashboard uses.
- Recurring events expand server-side via `recurring_ical_events` (the same path the other calendar_* widgets use). Exceptions and EXDATEs are honoured.

## Licence

AGPL-3.0-or-later.
