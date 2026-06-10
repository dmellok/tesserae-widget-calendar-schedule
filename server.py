"""calendar_schedule: Google-Calendar-style agenda view.

Lists upcoming events grouped by day with per-feed colour dots. Reads
from the same ``calendar_core`` feeds the other calendar_* widgets use.

Day grouping happens here, in the user's configured timezone, so an
event at 23:00 UTC on Wed renders under Thu's bucket for a user in
Europe/Berlin (UTC+2) the way the user expects. UTC ISO timestamps
still go out to the client unchanged so client.js can pick its own
locale-format for the time strings.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import current_app


def _parse_feeds_filter(s: str) -> list[str] | None:
    s = (s or "").strip()
    if not s:
        return None
    return [x.strip() for x in s.split(",") if x.strip()]


def _resolve_local_tz() -> ZoneInfo:
    """Read settings.app.timezone and return a ZoneInfo. Falls back to
    UTC for ``"system"`` (we don't have direct host TZ access from a
    widget; UTC is the safe default) and for unparseable values."""
    try:
        store = current_app.config.get("SETTINGS_STORE")
        raw = ""
        if store is not None:
            raw = str(store.get_section("app").get("timezone") or "").strip()
        if not raw or raw.lower() == "system":
            return ZoneInfo("UTC")
        return ZoneInfo(raw)
    except (ZoneInfoNotFoundError, Exception):
        return ZoneInfo("UTC")


def _parse_iso(value: str) -> datetime | None:
    """Parse an ISO string from calendar_core into an aware datetime
    (UTC if no tz info). All-day events arrive as plain ``YYYY-MM-DD``,
    which datetime.fromisoformat handles by returning a date; the
    caller converts to a datetime at midnight in the local zone."""
    try:
        if "T" in value:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        # Date-only string
        d = date.fromisoformat(value)
        return datetime.combine(d, time(0, 0))
    except (TypeError, ValueError):
        return None


def _local_date(dt: datetime, tz: ZoneInfo) -> date:
    if dt.tzinfo is None:
        return dt.date()
    return dt.astimezone(tz).date()


def _local_time_iso(dt: datetime, tz: ZoneInfo) -> str:
    """ISO with local-zone offset baked in so the client's ``new Date()``
    + ``toLocale...`` paints the wall-clock time directly without
    needing to apply its own offset."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(tz).isoformat()


def fetch(
    options: dict[str, Any], settings: dict[str, Any], *, ctx: dict[str, Any]
) -> dict[str, Any]:
    del settings, ctx
    registry = current_app.config["PLUGIN_REGISTRY"]
    core = registry.get("calendar_core")
    if core is None or core.server_module is None:
        return {"error": "calendar_core plugin not installed.", "days": []}

    try:
        days_ahead = max(1, int(options.get("days_ahead") or 5))
    except (TypeError, ValueError):
        days_ahead = 5
    feeds_filter = _parse_feeds_filter(options.get("feeds_filter") or "")
    show_location = bool(options.get("show_location", True))
    show_dot_color = bool(options.get("show_dot_color", True))
    time_format = (options.get("time_format") or "auto").strip().lower()
    skip_empty_days = bool(options.get("skip_empty_days", True))
    try:
        max_per_day = max(0, int(options.get("max_events_per_day") or 0))
    except (TypeError, ValueError):
        max_per_day = 0

    tz = _resolve_local_tz()
    now_local = datetime.now(tz)
    # Pad the window by a day on each end to catch:
    #   * events on "today" whose local start is just past midnight
    #     UTC of the day before (e.g. 00:30 BST = 23:30 UTC prior day)
    #   * the last day's overnight events that end into day+1
    window_start_utc = (now_local - timedelta(days=1)).astimezone(UTC)
    window_end_utc = (now_local + timedelta(days=days_ahead + 1)).astimezone(UTC)
    try:
        events = core.server_module.load_events(
            feeds_filter,
            window_start_utc,
            window_end_utc,
            data_dir=Path(core.data_dir),
        )
    except Exception as err:
        return {"error": f"{type(err).__name__}: {err}", "days": []}

    today_local = now_local.date()
    # Pre-populate each day bucket so missing days appear in the right
    # order; we drop empty ones at the end if skip_empty_days is on.
    buckets: dict[date, list[dict[str, Any]]] = {
        today_local + timedelta(days=i): [] for i in range(days_ahead)
    }
    last_local_date = today_local + timedelta(days=days_ahead - 1)

    for ev in events:
        s_raw = ev.get("start")
        if not isinstance(s_raw, str):
            continue
        sdt = _parse_iso(s_raw)
        if sdt is None:
            continue
        all_day = bool(ev.get("all_day"))
        edt = _parse_iso(ev.get("end") or s_raw) if ev.get("end") else sdt
        if edt is None:
            edt = sdt
        # All-day events arrived as YYYY-MM-DD; use the date raw.
        ev_date = sdt.date() if all_day else _local_date(sdt, tz)
        if ev_date < today_local or ev_date > last_local_date:
            continue

        row: dict[str, Any] = {
            "summary": ev.get("summary") or "(untitled)",
            "all_day": all_day,
            "colour": (ev.get("feed_colour") if show_dot_color else None),
            "feed_name": ev.get("feed_name") or "",
        }
        if show_location and ev.get("location"):
            row["location"] = ev.get("location")
        if not all_day:
            row["start_local"] = _local_time_iso(sdt, tz)
            row["end_local"] = _local_time_iso(edt, tz)
        buckets.setdefault(ev_date, []).append(row)

    days_out: list[dict[str, Any]] = []
    for offset in range(days_ahead):
        d = today_local + timedelta(days=offset)
        items = buckets.get(d) or []
        if skip_empty_days and not items:
            continue
        # All-day events first, then chronological by start.
        items.sort(key=lambda r: (not r["all_day"], r.get("start_local") or ""))
        if max_per_day > 0:
            items = items[:max_per_day]
        days_out.append(
            {
                "date_iso": d.isoformat(),
                "day_of_month": d.day,
                "day_of_week_short": d.strftime("%a").upper(),
                "month_short": d.strftime("%b").upper(),
                "is_today": d == today_local,
                "is_tomorrow": d == today_local + timedelta(days=1),
                "events": items,
            }
        )

    return {
        "now": now_local.isoformat(),
        "tz": str(tz),
        "time_format": time_format,
        "show_location": show_location,
        "show_dot_color": show_dot_color,
        "days": days_out,
        "count": sum(len(d["events"]) for d in days_out),
    }
