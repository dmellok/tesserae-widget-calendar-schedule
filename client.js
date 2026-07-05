// calendar_schedule: timeline-rail agenda renderer.
//
// The server has already grouped events by local-zone date and emitted
// start_local / end_local with the local-zone offset baked in. We only
// need to format the wall-clock time for display (12h vs 24h) and lay
// the rows out.
//
// v0.3.0: rewritten to the timeline-rail design. Feed colour lives in
// the start-time chip (and all-day bar). Titles wrap freely instead of
// truncating, so the widget stays legible at 3 to 4 columns on wide
// e-ink panels. Days flow column-first via CSS multi-column.

export default function render(shadow, ctx) {
  const data = (ctx && ctx.data) || {};
  const fontFamily = (ctx && ctx.font && ctx.font.family) || "Archivo, system-ui, sans-serif";
  shadow.innerHTML = layout(data, fontFamily);
  if (isAutoColumns(data)) {
    scheduleAutoColumns(shadow);
  }
}

function isAutoColumns(data) {
  return typeof data?.columns === "string" && data.columns.toLowerCase() === "auto";
}

// Overflow-driven column growth. Starts at 1 column and bumps up to 4
// until the day list stops overflowing horizontally into the implicit
// next-column zone. ``scrollWidth > clientWidth`` on ``.days`` catches
// that overflow because CSS multi-column with ``column-fill: auto`` and
// a definite height flows extra content into unrendered columns to the
// right. rAF defers the first check until after layout. ResizeObserver
// re-fits when the cell resizes (preview iframes, layout editor drags).
function scheduleAutoColumns(shadow) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => fitColumns(shadow));
  } else {
    fitColumns(shadow);
  }
  const host = shadow.host;
  if (host && typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => fitColumns(shadow));
    ro.observe(host);
  }
}

function fitColumns(shadow) {
  const frame = shadow.querySelector(".frame");
  const days = shadow.querySelector(".days");
  if (!frame || !days) return;
  for (let n = 1; n <= 4; n++) {
    frame.setAttribute("data-cols", String(n));
    // Force layout so scroll dimensions reflect the current column count.
    void days.offsetWidth;
    // At cols=1 there is no column-count set, so overflow shows up
    // vertically (scrollHeight > clientHeight). At cols>=2 with
    // column-fill: auto and a definite height, overflow shows up
    // horizontally as implicit next columns (scrollWidth > clientWidth).
    // Check both so the loop stops as soon as the list actually fits.
    const overflowV = days.scrollHeight > days.clientHeight + 1;
    const overflowH = days.scrollWidth > days.clientWidth + 1;
    if (!overflowV && !overflowH) return;
  }
  // Fell through the loop: even 4 columns overflow; leave at 4 and let
  // the container clip. Better to show as much as possible than to
  // silently drop back to 1.
}

function layout(data, fontFamily) {
  if (data && data.time_format && String(data.time_format).toLowerCase() === "auto") {
    data = { ...data, time_format: "12h" };
  }
  const showTitle = data.show_title !== false;
  const truncated = !!data.truncated;
  const titleHtml = showTitle ? renderTitle(truncated) : "";
  if (data.error) {
    return `
      ${styles(fontFamily)}
      <div class="frame">
        ${titleHtml}
        <div class="body"><div class="notice"><p>${escapeHtml(data.error)}</p></div></div>
      </div>
    `;
  }
  const days = Array.isArray(data.days) ? data.days : [];
  if (days.length === 0) {
    return `
      ${styles(fontFamily)}
      <div class="frame">
        ${titleHtml}
        <div class="body">
          <div class="notice">
            <i class="ph ph-calendar-blank" aria-hidden="true"></i>
            <p>No upcoming events.</p>
          </div>
        </div>
      </div>
    `;
  }
  const tf = (data.time_format || "12h").toLowerCase();
  // ``columns`` is either an integer 1..4 or the string "auto". Auto
  // renders with cols=1 initially; scheduleAutoColumns() bumps the
  // ``data-cols`` attribute up until content fits.
  const rawCols = Number(data.columns);
  const columns = Number.isFinite(rawCols)
    ? Math.max(1, Math.min(4, Math.floor(rawCols)))
    : 1;
  const showColour = data.show_dot_color !== false;
  return `
    ${styles(fontFamily)}
    <div class="frame" data-cols="${columns}">
      ${titleHtml}
      <div class="body">
        <div class="days">
          ${days.map((d) => renderDay(d, tf, showColour)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderTitle(truncated) {
  const truncatedPill = truncated
    ? `<span class="title-pill" title="More events were available; lift Max events across the whole agenda to show them.">capped</span>`
    : "";
  return `
    <div class="title">
      <i class="ph-bold ph-list-bullets" aria-hidden="true"></i>
      <span class="title-text">Schedule</span>
      ${truncatedPill}
    </div>
  `;
}

function renderDay(day, timeFormat, showColour) {
  const events = Array.isArray(day.events) ? day.events : [];
  const allDay = events.filter((e) => e && e.all_day === true);
  const timed = events.filter((e) => e && e.all_day !== true);
  const allDayHtml = allDay.length
    ? `<div class="all-day-stack">${allDay.map((e) => renderAllDay(e, showColour)).join("")}</div>`
    : "";
  const timedHtml = timed.length
    ? `<div class="rail">${timed.map((e) => renderTimed(e, timeFormat, showColour)).join("")}</div>`
    : "";
  const empty = !allDay.length && !timed.length
    ? `<div class="day-empty">(no events)</div>`
    : "";
  const todayClass = day.is_today ? " is-today" : "";
  return `
    <section class="day${todayClass}">
      <header class="day-header">
        <span class="day-num">${escapeHtml(String(day.day_of_month ?? ""))}</span>
        <span class="day-dow">${escapeHtml(day.day_of_week_short || "")}</span>
        <span class="day-month">${escapeHtml(day.month_short || "")}</span>
      </header>
      ${allDayHtml}
      ${timedHtml}
      ${empty}
    </section>
  `;
}

function renderAllDay(ev, showColour) {
  const title = escapeHtml(ev.summary || "(untitled)");
  const bg = showColour && ev.colour ? ev.colour : "var(--text-primary, #1B1A16)";
  const styleAttr = `style="background:${escapeAttr(bg)}"`;
  return `
    <div class="all-day" ${styleAttr}>
      <span class="all-day-label">ALL DAY</span>
      <span class="all-day-title">${title}</span>
    </div>
  `;
}

function renderTimed(ev, timeFormat, showColour) {
  const title = escapeHtml(ev.summary || "(untitled)");
  const startChip = formatChipLabel(ev.start_local, timeFormat);
  const endLabel = formatChipLabel(ev.end_local, timeFormat);
  const bg = showColour && ev.colour ? ev.colour : "var(--text-primary, #1B1A16)";
  const chipStyle = `style="background:${escapeAttr(bg)}"`;
  const sub = endLabel
    ? `until ${escapeHtml(endLabel)}${ev.location ? ` · ${escapeHtml(ev.location)}` : ""}`
    : (ev.location ? escapeHtml(ev.location) : "");
  return `
    <div class="rail-row">
      <div class="time-gutter">
        <span class="time-chip" ${chipStyle}>${escapeHtml(startChip || "")}</span>
      </div>
      <div class="rail-spine"><span class="rail-node"></span></div>
      <div class="rail-content">
        <div class="rail-title">${title}</div>
        ${sub ? `<div class="rail-sub">${sub}</div>` : ""}
      </div>
    </div>
  `;
}

function formatChipLabel(iso, format) {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const h24 = d.getHours();
  const m = d.getMinutes();
  if (format === "12h") {
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const suffix = h24 < 12 ? "am" : "pm";
    return m === 0 ? `${h12}${suffix}` : `${h12}:${pad2(m)}${suffix}`;
  }
  return `${pad2(h24)}:${pad2(m)}`;
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
        box-sizing: border-box;
        padding: clamp(10px, 2cqmin, 18px);
        display: flex;
        flex-direction: column;
        /* Container-query base size. Reference targets at an 800px min
           cell dimension: cols 1->19px, 2->17px, 3->16px, 4->15px. The
           14-22px clamp keeps the widget legible across the range of
           cell sizes Tesserae ships. */
        font-size: clamp(14px, calc(var(--f-scale, 2.4) * 1cqmin), 22px);
        line-height: 1.2;
      }
      .frame[data-cols="1"] { --f-scale: 2.4; }
      .frame[data-cols="2"] { --f-scale: 2.1; }
      .frame[data-cols="3"] { --f-scale: 2.0; }
      .frame[data-cols="4"] { --f-scale: 1.85; }

      /* Widget chrome title row (matches weather_now / calendar_day). */
      .title {
        display: flex;
        align-items: center;
        gap: 0.5em;
        padding: 0 0 0.4em 0;
        margin-bottom: 0.5em;
        border-bottom: 2px solid var(--border, #E5E1D6);
        font-size: 0.78em;
        font-weight: 800;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--text-muted, var(--muted, #8A8678));
        flex: 0 0 auto;
      }
      .title i {
        font-size: 1.1em;
        color: var(--accent-1, var(--accent, #C24F2C));
      }
      .title-text { flex: 1 1 auto; }
      .title-pill {
        flex: 0 0 auto;
        font-size: 0.85em;
        font-weight: 700;
        letter-spacing: 0.05em;
        padding: 0.1em 0.5em;
        border-radius: 999px;
        background: color-mix(in oklab, var(--text-primary, #1B1A16) 8%, transparent);
        color: var(--text-primary, #1B1A16);
      }

      .body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }

      /* Multi-column agenda. column-fill: auto needs a definite height
         on .days to know how much vertical space to fill before wrapping
         to the next column; height: 100% chains through the flex .body
         so it inherits the cell's remaining space. */
      .days {
        height: 100%;
        column-gap: 1.5em;
        column-rule: 2px solid var(--border, #E5E1D6);
        column-fill: auto;
      }
      .frame[data-cols="2"] .days { column-count: 2; }
      .frame[data-cols="3"] .days { column-count: 3; }
      .frame[data-cols="4"] .days { column-count: 4; }

      .day {
        break-inside: avoid;
        margin-bottom: 1em;
      }
      .day:last-child { margin-bottom: 0; }

      .day-header {
        display: flex;
        align-items: baseline;
        gap: 0.55em;
        border-bottom: 3px solid var(--text-primary, #1B1A16);
        padding-bottom: 0.15em;
      }
      .day-num {
        font-size: 2.3em;
        font-weight: 800;
        line-height: 0.82;
      }
      .day.is-today .day-num {
        color: var(--accent-1, var(--accent, #C24F2C));
      }
      .day-dow {
        font-size: 0.95em;
        font-weight: 800;
        letter-spacing: 0.06em;
      }
      .day-month {
        margin-left: auto;
        font-size: 0.78em;
        font-weight: 700;
        color: var(--text-muted, var(--muted, #8A8678));
      }

      .all-day-stack {
        display: flex;
        flex-direction: column;
        gap: 0.24em;
        margin-top: 0.44em;
      }
      .all-day {
        display: flex;
        align-items: center;
        gap: 0.5em;
        padding: 0.35em 0.65em;
        border-radius: 2px;
        color: var(--surface, #FCFBF7);
        font-weight: 800;
        font-size: 0.82em;
        white-space: nowrap;
        overflow: hidden;
      }
      .all-day-label {
        font-size: 0.72em;
        letter-spacing: 0.09em;
        opacity: 0.85;
        flex: 0 0 auto;
      }
      .all-day-title {
        flex: 1 1 auto;
        text-overflow: ellipsis;
        overflow: hidden;
      }

      .rail {
        display: flex;
        flex-direction: column;
        margin-top: 0.44em;
      }
      .rail-row {
        display: flex;
        align-items: stretch;
      }
      .time-gutter {
        flex: 0 0 auto;
        min-width: 3.25em;
        display: flex;
        justify-content: flex-end;
        padding-right: 0.6em;
        padding-top: 0.12em;
      }
      .time-chip {
        color: var(--surface, #FCFBF7);
        font-weight: 800;
        font-size: 0.72em;
        padding: 0.18em 0.36em;
        border-radius: 5px;
        white-space: nowrap;
        height: fit-content;
      }
      /* The rail is a 2px vertical line running the full row height so
         adjacent rows' rails abut into a continuous spine. The node dot
         is absolutely positioned on the rail so it lines up with the
         top of the title regardless of title wrap depth. */
      .rail-spine {
        flex: 0 0 auto;
        width: 2px;
        background: var(--border, #E5E1D6);
        position: relative;
      }
      .rail-node {
        position: absolute;
        left: -4px;
        top: 0.36em;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--text-primary, #1B1A16);
        border: 2px solid var(--surface, #FCFBF7);
        box-sizing: content-box;
      }
      .rail-content {
        flex: 1 1 0;
        min-width: 0;
        padding: 0.12em 0 0.72em 0.85em;
      }
      .rail-title {
        font-weight: 800;
        line-height: 1.14;
        overflow-wrap: break-word;
      }
      .rail-sub {
        font-size: 0.72em;
        font-weight: 600;
        color: var(--text-muted, var(--muted, #8A8678));
        margin-top: 0.06em;
      }

      .day-empty {
        font-size: 0.85em;
        color: var(--text-muted, var(--muted, #8A8678));
        margin-top: 0.4em;
      }

      .notice {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 0.4em;
        color: var(--text-muted, var(--muted, #8A8678));
        text-align: center;
      }
      .notice i { font-size: 2em; }
      .notice p { margin: 0; font-weight: 600; }
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
