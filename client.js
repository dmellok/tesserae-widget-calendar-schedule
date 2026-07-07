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
  } else {
    // Fixed-column path still needs the continuation-header pass so a
    // day whose events split across columns gets a "(cont.)" header at
    // the top of the secondary column.
    scheduleContinuationHeaders(shadow);
  }
}

function scheduleContinuationHeaders(shadow) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => ensureContinuationHeaders(shadow));
  } else {
    ensureContinuationHeaders(shadow);
  }
}

/*
 * v0.4.3 (r/eink launch feedback, flinkazoid): CSS multi-column doesn't
 * expose per-column break points, so when a day's events flow across a
 * column boundary the second column starts mid-day with no context.
 * This pass measures the rendered layout, groups events by column via
 * their left offset, and injects a cloned day header at the top of any
 * column that starts mid-day. Runs after fitColumns() has settled the
 * column count so we only measure once per layout.
 */
function ensureContinuationHeaders(shadow) {
  const days = shadow.querySelector(".days");
  if (!days) return;
  // Strip any continuation headers from a previous pass so a resize
  // that changes the break points doesn't stack duplicates.
  days.querySelectorAll(".day-header--continuation").forEach((n) => n.remove());
  const sections = days.querySelectorAll(".day[data-day-id]");
  // v0.4.8: derive a column INDEX (0..N-1) from the days container's
  // width + column-count + column-gap, then compare indices instead
  // of raw .left offsets. The v0.4.4 raw-pixel comparison sporadically
  // fired for the FIRST item of every section because header (flex
  // container with border-bottom) and rail-row (flex container with
  // time-chip + spine) measured .left with sub-pixel differences that
  // round to different integers on some panels, forcing a spurious
  // continuation header immediately below the original.
  const daysRect = days.getBoundingClientRect();
  const cs = getComputedStyle(days);
  const columnCount = Math.max(1, parseInt(cs.columnCount, 10) || 1);
  const columnGap = parseFloat(cs.columnGap) || 0;
  const columnWidth = (daysRect.width - (columnCount - 1) * columnGap) / columnCount;
  const columnStep = columnWidth + columnGap;
  const columnOf = (el) => {
    if (columnStep <= 0) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(columnCount - 1, Math.round((rect.left - daysRect.left) / columnStep)));
  };
  // Two-pass: measure every item's column FIRST, then insert. The
  // v0.4.3 single-pass version reflowed the column packer mid-loop
  // and caused stale readings.
  const plannedInsertions = [];
  sections.forEach((section) => {
    const header = section.querySelector("[data-day-header]");
    if (!header) return;
    const eventBlocks = Array.from(section.children).filter(
      (n) => n !== header && n.getBoundingClientRect
    );
    if (eventBlocks.length === 0) return;
    const headerColumn = columnOf(header);
    let lastColumn = headerColumn;
    eventBlocks.forEach((block) => {
      // ``all-day-stack`` and ``rail`` are wrappers; look inside them.
      const items = block.classList.contains("all-day-stack") || block.classList.contains("rail")
        ? Array.from(block.children)
        : [block];
      items.forEach((item) => {
        const col = columnOf(item);
        if (col !== lastColumn && col !== headerColumn) {
          plannedInsertions.push({ header, item });
          lastColumn = col;
        } else if (col !== lastColumn) {
          lastColumn = col;
        }
      });
    });
  });
  plannedInsertions.forEach(({ header, item }) => {
    const clone = header.cloneNode(true);
    clone.classList.add("day-header--continuation");
    clone.removeAttribute("data-day-header");
    item.parentElement.insertBefore(clone, item);
  });
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
    if (!overflowV && !overflowH) {
      ensureContinuationHeaders(shadow);
      return;
    }
  }
  // Fell through the loop: even 4 columns overflow; leave at 4 and let
  // the container clip. Better to show as much as possible than to
  // silently drop back to 1.
  ensureContinuationHeaders(shadow);
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
  // v0.4.2: per-content-type sizing knobs. Numbers are already clamped
  // server-side; the CSS custom props flow into rail-title / time-chip
  // / rail-sub / day-row padding so the user's cell config drives what
  // feels tight vs spacious without touching the widget CSS.
  const titleScale = numberOr(data.event_title_scale, 1.0);
  const timeScale = numberOr(data.event_time_scale, 1.0);
  const locScale = numberOr(data.event_location_scale, 0.9);
  const rowPad = numberOr(data.day_row_padding_em, 0.5);
  const styleAttr = `--title-scale:${titleScale};--time-scale:${timeScale};--loc-scale:${locScale};--row-pad:${rowPad}em;`;
  return `
    ${styles(fontFamily)}
    <div class="frame" data-cols="${columns}" style="${styleAttr}">
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
  // v0.4.3: stamp a stable id + duplicated header markup on data-*
  // attributes so JS can clone the day header at the top of any
  // secondary column when the day's events span a column boundary
  // (see ensureContinuationHeaders).
  const dayId = escapeAttr(day.date_iso || `${day.month_short}-${day.day_of_month}`);
  return `
    <section class="day${todayClass}" data-day-id="${dayId}">
      <header class="day-header" data-day-header>
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

function numberOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

      /* v0.4.3 (r/eink launch feedback, flinkazoid): days used to be
         atomic (break-inside: avoid) so a day too tall for its column
         got shoved to the next one, leaving a gap at the bottom of
         the current column. Now the day container allows breaks; the
         atomic units are the header + each event row.
         v0.4.4: tightened the inter-day margins — a 1em bottom margin
         on every .day was becoming column-end whitespace whenever a
         day happened to be the last item in a column. Zero out the
         between-day gap on the container itself and lean on
         .day-header's own margin-top + bottom-border to space days
         apart. This gives the column packer 1em more per day-boundary
         to fit the next event. */
      .day { margin: 0; }
      .day + .day > .day-header,
      .day > .day-header--continuation {
        margin-top: 0.55em;
      }
      .day-header,
      .rail-row,
      .all-day {
        break-inside: avoid;
      }
      /* Continuation breadcrumb injected by JS at the top of a
         column when a day's events split across columns. v0.4.9:
         explicitly styled as a small dashed breadcrumb (not a scaled
         down clone of the real header) so the eye doesn't read it as
         a duplicate date on the panel. The children spans keep their
         DOM text but shrink to a single muted one-liner. */
      .day-header--continuation {
        margin-top: 0;
        gap: 0.3em;
        align-items: center;
        border-bottom: 1px dashed var(--text-muted, var(--muted, #8A8678));
        padding-bottom: 0.08em;
        opacity: 1;
        color: var(--text-muted, var(--muted, #8A8678));
      }
      .day-header--continuation .day-num {
        font-size: 0.9em;
        font-weight: 600;
        line-height: 1;
        color: var(--text-muted, var(--muted, #8A8678));
      }
      .day.is-today .day-header--continuation .day-num {
        color: var(--text-muted, var(--muted, #8A8678));
      }
      .day-header--continuation .day-dow {
        font-size: 0.75em;
        font-weight: 600;
        letter-spacing: 0.06em;
      }
      .day-header--continuation .day-month {
        font-size: 0.72em;
        font-weight: 500;
      }
      .day-header--continuation::before {
        content: "↳";
        font-size: 0.9em;
        color: var(--text-muted, var(--muted, #8A8678));
        margin-right: 0.15em;
        line-height: 1;
      }
      .day-header--continuation::after {
        content: "cont.";
        font-size: 0.62em;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted, var(--muted, #8A8678));
        margin-left: 0.35em;
        opacity: 0.8;
      }

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
        font-size: calc(0.72em * var(--time-scale, 1));
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
        /* v0.4.4: bottom padding shrunk (0.72em -> 0.42em) so each row
           consumes less vertical space. In CSS multi-column with
           column-fill: auto every wasted em at the bottom of a row is
           lost trailing whitespace when the next row can't fit; a
           tighter row lets more events squeeze in per column. */
        padding: 0.12em 0 0.42em 0.85em;
      }
      .rail-title {
        font-weight: 800;
        line-height: 1.14;
        overflow-wrap: break-word;
        font-size: calc(1em * var(--title-scale, 1));
      }
      .rail-sub {
        font-size: calc(0.72em * var(--loc-scale, 0.9) / 0.9);
        font-weight: 600;
        color: var(--text-muted, var(--muted, #8A8678));
        margin-top: 0.06em;
      }
      /* Day row spacing: user-tunable padding above + below each
         day block, expressed in em so it scales with the auto-fit
         font size. Default 0.5em roughly matches the pre-v0.4.2
         built-in spacing. */
      .day {
        padding-top: var(--row-pad, 0.5em);
        padding-bottom: var(--row-pad, 0.5em);
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
