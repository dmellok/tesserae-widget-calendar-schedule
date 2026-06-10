// calendar_schedule: Google-Calendar-style agenda renderer.
//
// The server has already grouped events by local-zone date and emitted
// start_local / end_local with the local-zone offset baked in. We only
// need to format the wall-clock time for display (12h vs 24h) and lay
// the rows out.

export default function render(shadow, ctx) {
  const data = (ctx && ctx.data) || {};
  const fontFamily = (ctx && ctx.font && ctx.font.family) || "system-ui";
  shadow.innerHTML = layout(data, fontFamily);
  scheduleAutoFit(shadow);
}

// Measure the rendered content vs the cell height and set a CSS scale
// variable so the agenda fills the available space without overflowing.
// rAF defers measurement until after the first layout pass. ResizeObserver
// re-fits when the cell resizes (preview iframes, layout editor drags).
function scheduleAutoFit(shadow) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => fitToHeight(shadow));
  } else {
    fitToHeight(shadow);
  }
  if (typeof ResizeObserver === "function") {
    const frame = shadow.querySelector(".frame");
    if (frame) {
      const ro = new ResizeObserver(() => fitToHeight(shadow));
      ro.observe(frame);
    }
  }
}

// Single-pass shrink-or-grow. Measure base scale, compute target/actual
// ratio, apply. The 0.6 floor stops the font from getting so small the
// text becomes illegible; the 1.6 ceiling stops a single-event cell from
// blowing up the day-number out of proportion.
function fitToHeight(shadow) {
  const frame = shadow.querySelector(".frame");
  const days = shadow.querySelector(".days");
  if (!frame || !days) return;
  frame.style.setProperty("--auto-font-scale", "1");
  const target = frame.clientHeight;
  const actual = days.scrollHeight;
  if (!target || !actual) return;
  let scale = 1;
  if (actual > target) {
    scale = Math.max(0.6, target / actual);
  } else if (actual * 1.6 < target) {
    scale = Math.min(1.6, (target / actual) * 0.92);
  }
  if (Math.abs(scale - 1) > 0.02) {
    frame.style.setProperty("--auto-font-scale", String(scale));
  }
}

function layout(data, fontFamily) {
  // Honour the documented "12h" / "24h" choices; legacy "auto" (shipped
  // in v0.1.0) falls back to 12h to match the new default.
  if (data && data.time_format && String(data.time_format).toLowerCase() === "auto") {
    data = { ...data, time_format: "12h" };
  }
  if (data.error) {
    return `
      ${styles(fontFamily)}
      <div class="frame">
        <div class="error"><p>${escapeHtml(data.error)}</p></div>
      </div>
    `;
  }
  const days = Array.isArray(data.days) ? data.days : [];
  if (days.length === 0) {
    return `
      ${styles(fontFamily)}
      <div class="frame">
        <div class="empty">
          <i class="ph ph-calendar-blank" aria-hidden="true"></i>
          <p>No upcoming events.</p>
        </div>
      </div>
    `;
  }
  const tf = (data.time_format || "12h").toLowerCase();
  return `
    ${styles(fontFamily)}
    <div class="frame">
      <ul class="days">
        ${days.map((d) => renderDay(d, tf)).join("")}
      </ul>
    </div>
  `;
}

function renderDay(day, timeFormat) {
  const rows = (day.events || []).map((e) => renderRow(e, timeFormat)).join("");
  const todayClass = day.is_today ? " is-today" : "";
  const tomorrowClass = day.is_tomorrow ? " is-tomorrow" : "";
  return `
    <li class="day${todayClass}${tomorrowClass}">
      <div class="day-marker">
        <div class="day-num">${escapeHtml(String(day.day_of_month ?? ""))}</div>
        <div class="day-stub">
          <span class="day-month">${escapeHtml(day.month_short || "")}</span>
          <span class="day-dow">${escapeHtml(day.day_of_week_short || "")}</span>
        </div>
      </div>
      <ul class="rows">
        ${rows || `<li class="row row--empty"><span class="row-time">—</span><span class="row-title muted">(no events)</span></li>`}
      </ul>
    </li>
  `;
}

function renderRow(ev, timeFormat) {
  const isAllDay = ev.all_day === true;
  const timeStr = isAllDay
    ? "All day"
    : formatTimeRange(ev.start_local, ev.end_local, timeFormat);
  const dot = ev.colour
    ? `<span class="row-dot" style="background:${escapeHtml(ev.colour)};"></span>`
    : `<span class="row-dot row-dot--blank"></span>`;
  const title = escapeHtml(ev.summary || "(untitled)");
  const location = ev.location
    ? `<span class="row-location">${escapeHtml(ev.location)}</span>`
    : "";
  return `
    <li class="row">
      <span class="row-time">${escapeHtml(timeStr)}</span>
      ${dot}
      <span class="row-title">${title}${location}</span>
    </li>
  `;
}

function formatTimeRange(startIso, endIso, format) {
  const startParts = formatTimeParts(startIso, format);
  if (!startParts) return "";
  if (!endIso || endIso === startIso) return startParts.label;
  const endParts = formatTimeParts(endIso, format);
  if (!endParts) return startParts.label;
  // Google Calendar trick: suppress the start's am/pm suffix when start
  // and end share it, so "3:45pm - 4:45pm" becomes "3:45 - 4:45pm".
  // Saves a few chars and reads more naturally for same-period ranges.
  if (format === "12h" && startParts.suffix && startParts.suffix === endParts.suffix) {
    return `${startParts.body} – ${endParts.label}`;
  }
  return `${startParts.label} – ${endParts.label}`;
}

function formatTimeParts(iso, format) {
  if (typeof iso !== "string") return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const h24 = d.getHours();
  const m = d.getMinutes();
  if (format === "12h") {
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const suffix = h24 < 12 ? "am" : "pm";
    // Always show minutes for consistency. "10:00am" not "10am".
    const body = `${h12}:${pad2(m)}`;
    return { body, suffix, label: `${body}${suffix}` };
  }
  // 24h
  const label = `${pad2(h24)}:${pad2(m)}`;
  return { body: label, suffix: "", label };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function styles(fontFamily) {
  return `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
        overflow: hidden;
        font-family: var(--font-family, ${escapeAttr(fontFamily)});
        color: var(--text-primary, #1B1A16);
        background: var(--surface, #FCFBF7);
        container-type: size;
      }
      .frame {
        width: 100%;
        height: 100%;
        overflow: hidden;
        padding: clamp(4px, 1.5cqmin, 14px) clamp(6px, 2cqmin, 18px);
        box-sizing: border-box;
        /* Base size is bigger than v0.1.0 (0.85em min, 2.8cqmin mid,
           1.2em max); the JS auto-fit then multiplies by a scale that
           expands to fill remaining vertical space or shrinks to
           prevent overflow. */
        font-size: calc(clamp(0.85em, 2.8cqmin, 1.2em) * var(--auto-font-scale, 1));
        line-height: 1.3;
      }
      .days {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .day {
        display: grid;
        grid-template-columns: clamp(34px, 8cqmin, 60px) 1fr;
        /* em-based gaps + padding so the layout breathes together with
           the JS auto-fit font scale. When the font grows to fill a
           tall cell, the vertical rhythm grows with it; when it
           shrinks, things stay tight. */
        gap: 0.9em;
        align-items: start;
        padding: 0.5em 0;
        border-top: 1px solid var(--border, #E5E1D6);
      }
      .day:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .day-marker {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        line-height: 1;
      }
      .day-num {
        font-size: 1.45em;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .day-stub {
        display: flex;
        flex-direction: column;
        margin-top: 0.25em;
        font-size: 0.65em;
        letter-spacing: 0.08em;
        color: var(--muted, #76705E);
        text-transform: uppercase;
        font-weight: 600;
      }
      .day-dow {
        margin-top: 0.1em;
      }
      .day.is-today .day-num {
        color: var(--accent, #C24F2C);
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        /* em-based vertical gap so rows breathe in sync with the
           auto-fit font scale. */
        gap: 0.3em;
        min-width: 0;
      }
      .row {
        display: grid;
        /* Time column sized in 'ch' so it scales with the font and
           fits the longest 12h range (about 13ch). Dot column sized
           in em so it never crowds the title at high zoom. */
        grid-template-columns: minmax(6ch, 13ch) 1.2em 1fr;
        column-gap: 0.7em;
        align-items: baseline;
        min-width: 0;
      }
      .row-time {
        font-variant-numeric: tabular-nums;
        color: var(--muted, #76705E);
        font-size: 0.9em;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .row-dot {
        width: 0.65em;
        height: 0.65em;
        border-radius: 50%;
        display: inline-block;
        align-self: center;
        background: var(--muted, #76705E);
      }
      .row-dot--blank {
        visibility: hidden;
      }
      .row-title {
        font-weight: 500;
        min-width: 0;
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
      }
      .row-location {
        margin-left: 0.7em;
        color: var(--muted, #76705E);
        font-weight: 400;
        font-size: 0.92em;
      }
      .row--empty .row-time {
        color: var(--border, #E5E1D6);
      }
      .row--empty .row-title {
        font-style: italic;
        font-weight: 400;
      }
      .muted {
        color: var(--muted, #76705E);
      }
      .error, .empty {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.4em;
        text-align: center;
        color: var(--muted, #76705E);
      }
      .empty i {
        font-size: 2.2em;
        opacity: 0.5;
      }
      .empty p, .error p {
        margin: 0;
      }
    </style>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "\\\"");
}
