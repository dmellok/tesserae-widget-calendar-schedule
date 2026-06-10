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
}

function layout(data, fontFamily) {
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
  const tf = (data.time_format || "auto").toLowerCase();
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
    const body = m === 0 ? `${h12}` : `${h12}:${pad2(m)}`;
    return { body, suffix, label: `${body}${suffix}` };
  }
  // 24h (and auto)
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
        font-size: clamp(0.7em, 2.6cqmin, 1.05em);
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
        gap: clamp(6px, 1.8cqmin, 16px);
        align-items: start;
        padding: clamp(4px, 1.4cqmin, 10px) 0;
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
        gap: clamp(2px, 0.8cqmin, 6px);
        min-width: 0;
      }
      .row {
        display: grid;
        grid-template-columns: clamp(48px, 14cqmin, 120px) clamp(8px, 1.8cqmin, 14px) 1fr;
        gap: clamp(4px, 1.2cqmin, 10px);
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
