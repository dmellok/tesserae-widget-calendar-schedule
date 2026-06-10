"""Smoke tests for the calendar_schedule widget.

The widget composes calendar_core's ``load_events`` output into a
day-grouped agenda. We patch ``load_events`` so the tests don't reach
out to real ICS feeds, then assert on the day-grouping + sorting
logic that's unique to this widget.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server


def _stub_calendar_core(events: list[dict[str, Any]]) -> MagicMock:
    core = MagicMock()
    core.server_module.load_events.return_value = events
    core.data_dir = "/tmp/calendar_core_unused"
    return core


def _stub_app(tz_setting: str = "UTC") -> MagicMock:
    """Stub of ``flask.current_app`` with the minimum config the widget
    reads: plugin registry + settings store."""
    settings = MagicMock()
    settings.get_section.return_value = {"timezone": tz_setting}
    registry = MagicMock()
    # ``registry.get`` returns the stubbed core when the widget asks for it.
    core = _stub_calendar_core([])
    registry.get.return_value = core
    app = MagicMock()
    app.config = {
        "PLUGIN_REGISTRY": registry,
        "SETTINGS_STORE": settings,
    }
    return app, registry, core, settings


def test_fetch_returns_empty_days_when_no_events() -> None:
    """No events anywhere -> ``days`` is empty by default
    (``skip_empty_days=True``)."""
    app, _registry, _core, _settings = _stub_app()
    with patch.object(server, "current_app", app):
        out = server.fetch(
            options={"days_ahead": "5"},
            settings={},
            ctx={},
        )
    assert "error" not in out
    assert out["days"] == []
    assert out["count"] == 0


def test_fetch_groups_events_into_today_and_tomorrow() -> None:
    """Two events on consecutive days land in their own day buckets,
    sorted with all-day at the top."""
    app, _registry, core, _settings = _stub_app()
    today = datetime.now(UTC).date()
    tomorrow = today + timedelta(days=1)
    core.server_module.load_events.return_value = [
        {
            "summary": "Stand-up",
            "start": f"{today.isoformat()}T09:00:00+00:00",
            "end": f"{today.isoformat()}T09:30:00+00:00",
            "all_day": False,
            "feed_name": "Work",
            "feed_colour": "#3366CC",
            "location": "Zoom",
        },
        {
            "summary": "Book fair",
            "start": tomorrow.isoformat(),
            "end": tomorrow.isoformat(),
            "all_day": True,
            "feed_name": "School",
            "feed_colour": "#22AA88",
            "location": "",
        },
    ]
    with patch.object(server, "current_app", app):
        out = server.fetch(
            options={"days_ahead": "3"},
            settings={},
            ctx={},
        )
    assert "error" not in out
    assert len(out["days"]) == 2
    assert out["days"][0]["is_today"] is True
    assert out["days"][0]["events"][0]["summary"] == "Stand-up"
    assert out["days"][0]["events"][0]["all_day"] is False
    assert out["days"][1]["is_tomorrow"] is True
    assert out["days"][1]["events"][0]["all_day"] is True
    assert out["count"] == 2


def test_all_day_events_come_first_within_a_day() -> None:
    """The screenshot shows All-day events at the top of each day; the
    widget must sort them that way regardless of feed order."""
    app, _registry, core, _settings = _stub_app()
    today = datetime.now(UTC).date()
    core.server_module.load_events.return_value = [
        {
            "summary": "Morning meeting",
            "start": f"{today.isoformat()}T09:00:00+00:00",
            "end": f"{today.isoformat()}T10:00:00+00:00",
            "all_day": False,
            "feed_name": "Work",
            "feed_colour": "#000",
        },
        {
            "summary": "Public holiday",
            "start": today.isoformat(),
            "end": today.isoformat(),
            "all_day": True,
            "feed_name": "Holidays",
            "feed_colour": "#FF0",
        },
    ]
    with patch.object(server, "current_app", app):
        out = server.fetch(options={"days_ahead": "1"}, settings={}, ctx={})
    events = out["days"][0]["events"]
    assert events[0]["all_day"] is True
    assert events[0]["summary"] == "Public holiday"
    assert events[1]["all_day"] is False


def test_show_dot_color_off_omits_colour() -> None:
    """When show_dot_color is False, ``colour`` is None so the client
    renders a blank slot (preserves vertical alignment)."""
    app, _registry, core, _settings = _stub_app()
    today = datetime.now(UTC).date()
    core.server_module.load_events.return_value = [
        {
            "summary": "x",
            "start": f"{today.isoformat()}T09:00:00+00:00",
            "end": f"{today.isoformat()}T10:00:00+00:00",
            "all_day": False,
            "feed_name": "y",
            "feed_colour": "#abc",
        }
    ]
    with patch.object(server, "current_app", app):
        out = server.fetch(
            options={"days_ahead": "1", "show_dot_color": False},
            settings={},
            ctx={},
        )
    assert out["days"][0]["events"][0]["colour"] is None


def test_show_location_off_drops_location_field() -> None:
    app, _registry, core, _settings = _stub_app()
    today = datetime.now(UTC).date()
    core.server_module.load_events.return_value = [
        {
            "summary": "x",
            "start": f"{today.isoformat()}T09:00:00+00:00",
            "end": f"{today.isoformat()}T10:00:00+00:00",
            "all_day": False,
            "feed_name": "y",
            "feed_colour": "#abc",
            "location": "Hill Media Center",
        }
    ]
    with patch.object(server, "current_app", app):
        out = server.fetch(
            options={"days_ahead": "1", "show_location": False},
            settings={},
            ctx={},
        )
    assert "location" not in out["days"][0]["events"][0]


def test_max_events_per_day_truncates() -> None:
    app, _registry, core, _settings = _stub_app()
    today = datetime.now(UTC).date()
    core.server_module.load_events.return_value = [
        {
            "summary": f"event {i}",
            "start": f"{today.isoformat()}T{9 + i:02d}:00:00+00:00",
            "end": f"{today.isoformat()}T{10 + i:02d}:00:00+00:00",
            "all_day": False,
            "feed_name": "y",
            "feed_colour": "#abc",
        }
        for i in range(6)
    ]
    with patch.object(server, "current_app", app):
        out = server.fetch(
            options={"days_ahead": "1", "max_events_per_day": 3},
            settings={},
            ctx={},
        )
    assert len(out["days"][0]["events"]) == 3


def test_skip_empty_days_off_keeps_blank_buckets() -> None:
    """``skip_empty_days=False`` shows every day in the window, even
    when the day has no events. Matches the screenshot's "Mon -- no
    events but still listed" pattern (sort of, the screenshot only
    shows populated days; this is the explicit opt-out)."""
    app, _registry, _core, _settings = _stub_app()
    with patch.object(server, "current_app", app):
        out = server.fetch(
            options={"days_ahead": "3", "skip_empty_days": False},
            settings={},
            ctx={},
        )
    assert len(out["days"]) == 3
    for d in out["days"]:
        assert d["events"] == []


def test_missing_calendar_core_surfaces_error() -> None:
    """No calendar_core installed -> friendly error, no crash."""
    app = MagicMock()
    registry = MagicMock()
    registry.get.return_value = None
    app.config = {"PLUGIN_REGISTRY": registry, "SETTINGS_STORE": MagicMock()}
    with patch.object(server, "current_app", app):
        out = server.fetch(options={}, settings={}, ctx={})
    assert "error" in out
    assert "calendar_core" in out["error"]


def test_filter_window_excludes_events_outside_days_ahead() -> None:
    """Events more than ``days_ahead`` away get filtered out even
    though the core fetch's pad window included them. The widget
    should not surface a "day 8" event when days_ahead=3."""
    app, _registry, core, _settings = _stub_app()
    today = datetime.now(UTC).date()
    far_future = today + timedelta(days=8)
    core.server_module.load_events.return_value = [
        {
            "summary": "should not appear",
            "start": f"{far_future.isoformat()}T09:00:00+00:00",
            "end": f"{far_future.isoformat()}T10:00:00+00:00",
            "all_day": False,
            "feed_name": "y",
            "feed_colour": "#abc",
        }
    ]
    with patch.object(server, "current_app", app):
        out = server.fetch(options={"days_ahead": "3"}, settings={}, ctx={})
    assert out["count"] == 0
    assert out["days"] == []


def test_feeds_filter_parses_comma_separated_list() -> None:
    assert server._parse_feeds_filter("") is None
    assert server._parse_feeds_filter(" ") is None
    assert server._parse_feeds_filter("a,b,c") == ["a", "b", "c"]
    assert server._parse_feeds_filter("a , b,  c  ") == ["a", "b", "c"]
    assert server._parse_feeds_filter("a,,b") == ["a", "b"]
