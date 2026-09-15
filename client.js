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

// Clamps a cell-option slider value, defaulting on missing/non-numeric
// input. Ported from server.py's _coerce_scale — server.py used to clamp
// event_title_scale / event_time_scale / event_location_scale /
// day_row_padding_em before sending them down; now the raw slider value
// comes straight through in ctx.cell.options and this does the clamping
// client-side instead.
// date_label_style cell option: "short" (default, 3-letter upper-case),
// "minimal" (1-2 chars), or "full" (whole word). v0.7.0: the label is
// derived client-side from the day's ``date_iso`` in the panel's locale
// (ctx.locale) via Intl, the same way the bundled calendar_* widgets do
// it, so a Slovak panel reads "PON" / "SEP" rather than the server's
// C-locale strftime output. English keeps its hand-picked tables so the
// minimal style stays unambiguous (Tu/Th, Jn/Jl); other languages take
// the first two letters of the Intl name.
const DOW_MINIMAL = { SUN: "SU", MON: "M", TUE: "TU", WED: "W", THU: "TH", FRI: "F", SAT: "SA" };
const MONTH_MINIMAL = { JAN: "JA", FEB: "F", MAR: "MR", APR: "AP", MAY: "MY", JUN: "JN", JUL: "JL", AUG: "AU", SEP: "S", OCT: "O", NOV: "N", DEC: "D" };
const DOW_FULL = { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };
const MONTH_FULL = { JAN: "January", FEB: "February", MAR: "March", APR: "April", MAY: "May", JUN: "June", JUL: "July", AUG: "August", SEP: "September", OCT: "October", NOV: "November", DEC: "December" };

// Legacy path: style a server-provided English 3-letter label. Kept for
// a ``days[]`` row with no ``date_iso`` (pre-0.7 server) and for English,
// where the tables above are the source of truth.
export function styleShortLabel(label, style, minimalMap, fullMap) {
  if (style === "minimal") return minimalMap[label] || label.slice(0, 2);
  if (style === "full") return (fullMap && fullMap[label]) || label;
  return label;
}

// "YYYY-MM-DD" -> local Date at midnight (no UTC shift), or null.
export function parseDateIso(iso) {
  const m = typeof iso === "string" && /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
}

function isEnglish(locale) {
  return String(locale || "en").split("-")[0].toLowerCase() === "en";
}

function intlName(date, unit, locale) {
  try {
    return new Intl.DateTimeFormat(locale, { [unit]: "long" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { [unit]: "long" }).format(date);
  }
}

// Weekday or month label for one day row, in ``style``, for ``locale``.
// ``unit`` is "weekday" or "month". Falls back to the server's English
// short label when the row carries no parseable ``date_iso``.
export function dayLabel(day, unit, style, locale) {
  const date = parseDateIso(day && day.date_iso);
  const serverShort = unit === "weekday" ? (day && day.day_of_week_short) || "" : (day && day.month_short) || "";
  if (!date || isEnglish(locale)) {
    return styleShortLabel(
      serverShort || (date ? intlName(date, unit, "en").slice(0, 3).toUpperCase() : ""),
      style,
      unit === "weekday" ? DOW_MINIMAL : MONTH_MINIMAL,
      unit === "weekday" ? DOW_FULL : MONTH_FULL,
    );
  }
  const full = intlName(date, unit, locale);
  if (style === "full") return full.charAt(0).toUpperCase() + full.slice(1);
  if (style === "minimal") return full.slice(0, 2).toUpperCase();
  return full.slice(0, 3).toUpperCase();
}

// ISO 8601 week number for a local-midnight Date: weeks start on Monday
// and week 1 holds the year's first Thursday, so 1 Jan can sit in week 52
// or 53 of the previous year and 31 Dec in week 1 of the next. Done in UTC
// arithmetic so a DST change inside the year can't shift the day count.
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
}

// "off" (default), "week_start" (the first day shown from each ISO week)
// or "every_day". Anything else is off.
export function normalizeWeekNumber(raw) {
  const s = String(raw ?? "off").trim().toLowerCase();
  return s === "week_start" || s === "every_day" ? s : "off";
}

// Week badge text for one day header, or "" when the mode or this day's
// position in the list doesn't call for one. ``prevWeek`` is the ISO week
// of the previous rendered day (null for the first), so with skipped
// empty days the badge lands on whichever day of the week shows first.
export function weekLabel(day, mode, prevWeek, t) {
  if (mode === "off") return "";
  const date = parseDateIso(day && day.date_iso);
  if (!date) return "";
  const week = isoWeek(date);
  if (mode === "week_start" && prevWeek === week) return "";
  return t("week_n", "W{n}").replace("{n}", String(week));
}

// ctx.t() when the host provides it (Tesserae >= 0.364 with this widget's
// ``locales`` declared); otherwise the English fallback text.
function translator(ctx) {
  const t = ctx && typeof ctx.t === "function" ? ctx.t : null;
  return (key, fallback) => {
    const out = t ? t(key, fallback) : fallback;
    return typeof out === "string" && out ? out : fallback;
  };
}

// A string safe to embed inside a CSS double-quoted string token.
function cssString(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

export function clampScale(raw, def, lo, hi) {
  const v = raw === null || raw === undefined || raw === "" ? def : Number(raw);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}

// "auto" (client grows 1..4 until the list fits) or an integer 1..4
// (fixed count). Anything else falls back to auto. Ported from
// server.py's raw_columns handling.
export function normalizeColumns(raw) {
  const s = String(raw ?? "auto").trim().toLowerCase();
  if (s === "auto") return "auto";
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : 1;
}

// Cell options live at ctx.cell.options (see docs/widgets.md's ctx shape),
// not top-level ctx.options. Named + exported so a regression back to the
// wrong path is a one-line, testable fact instead of silently no-op-ing
// every option this file itself reads from it (columns, the scale
// sliders, date_label_style) — the bug this shipped with for a while.
// Options server.py consumes directly (show_location, show_dot_color,
// time_format, skip_empty_days, max_events_per_day/total, show_title)
// were never affected; those never went through ctx.cell.options.
export function readOptions(ctx) {
  return (ctx && ctx.cell && ctx.cell.options) || {};
}

// -- symbol dots (v0.6.0) --------------------------------------------------
// A 1-bit panel quantises every feed colour to the same ink, so the rail
// node can't tell two calendars apart. use_symbol_dot swaps the bullet for
// a shape picked from the feed colour, which survives dithering.

const HEX6 = /^#[0-9a-fA-F]{6}$/;

// What an unusable feed colour falls back to, and what the rail draws when
// the option is off: the bullet this widget has always used. It doubles as
// the vivid-red glyph below, which only collides if a feed colour is
// unparseable, and that already means the symbol carries no information.
export const FALLBACK_SYMBOL = "●";

// #rrggbb -> {hue: 0-360, sat: 0-1, val: 0-1}. Callers must pre-validate
// with HEX6; a short or malformed hex would parse to NaN and poison every
// comparison downstream (NaN < x and NaN >= x are both false, so the
// bucket maths silently lands on an out-of-range index).
function toHSV(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { hue: h, sat: s, val: v };
}

const HUE_BUCKETS = 8;
const SAT_THRESHOLD = 0.5; // above this is "high saturation"
const GRAY_SAT_THRESHOLD = 0.04; // below this, treat as greyscale regardless of hue
const GRAY_LEVELS = 3; // dark / mid / light grey
// GRAY_LEVELS + HUE_BUCKETS * 2 = 19 buckets, so SYMBOLS and BUCKET_NAMES
// must both be 19 long with no repeats: a duplicate or a short array makes
// two different feeds share a glyph, which is the one thing this option
// exists to prevent. tests/clamp_check.mjs asserts the invariant.
// Hollow shapes are the low-saturation half of each hue, solid the high,
// so a washed-out feed reads lighter than a vivid one at a glance.
const SYMBOLS = [
  "█", "▒", "░",
  "○", "□", "△", "▽", "◇", "☆", "◁", "▷",
  "●", "■", "▲", "▼", "◆", "★", "◀", "▶",
];
const BUCKET_NAMES = [
  "Black", "Grey", "White",
  "Light Red", "Light Amber", "Light Yellow-Green", "Light Green",
  "Light Cyan", "Light Blue", "Light Purple", "Light Magenta",
  "Red", "Amber", "Yellow-Green", "Green",
  "Cyan", "Blue", "Purple", "Magenta",
];

// #rrggbb -> 0..18. 0-2 greyscale by lightness, 3-10 low-saturation hues,
// 11-18 the same hues at high saturation.
export function colorBucket(hex) {
  const hsv = toHSV(hex);

  if (hsv.sat < GRAY_SAT_THRESHOLD) {
    return Math.min(GRAY_LEVELS - 1, Math.floor(hsv.val * GRAY_LEVELS));
  }

  const hueBucket = Math.floor(hsv.hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
  return GRAY_LEVELS + hueBucket + (hsv.sat <= SAT_THRESHOLD ? 0 : HUE_BUCKETS);
}

// Feed colours are written by calendar_core, which validates them as
// #rrggbb, but a hand-edited feed store can still carry a short hex or a
// colour name. Fall back to the plain bullet rather than rendering the
// string "undefined" into the rail.
export function colorToSymbol(hex) {
  if (typeof hex !== "string" || !HEX6.test(hex)) return FALLBACK_SYMBOL;
  return SYMBOLS[colorBucket(hex)];
}

export const SYMBOL_TABLE = { symbols: SYMBOLS, names: BUCKET_NAMES };

export default function render(shadow, ctx) {
  const data = (ctx && ctx.data) || {};
  const options = readOptions(ctx);
  const fontFamily = (ctx && ctx.font && ctx.font.family) || "Archivo, system-ui, sans-serif";
  shadow.innerHTML = layout(data, options, fontFamily, ctx);
  if (isAutoColumns(options)) {
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
        // v0.4.10: strictly-forward guard. Continuation only fires
        // when the item lands in a column BEYOND both the header
        // and every previously-seen item. Prevents a spurious
        // continuation from firing in the same column as the header
        // if columnOf mis-measures under dense packing or on wide
        // panels where sub-pixel offsets don't round cleanly.
        if (col > headerColumn && col > lastColumn) {
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

function isAutoColumns(options) {
  return normalizeColumns(options?.columns) === "auto";
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

function layout(data, options, fontFamily, ctx) {
  const t = translator(ctx);
  const locale = (ctx && ctx.locale) || "en";
  if (data && data.time_format && String(data.time_format).toLowerCase() === "auto") {
    data = { ...data, time_format: "12h" };
  }
  const showTitle = data.show_title !== false;
  const truncated = !!data.truncated;
  const titleHtml = showTitle ? renderTitle(truncated, t) : "";
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
            <p>${escapeHtml(t("no_upcoming", "No upcoming events."))}</p>
          </div>
        </div>
      </div>
    `;
  }
  const tf = (data.time_format || "12h").toLowerCase();
  // ``columns`` is either an integer 1..4 or the string "auto". Auto
  // renders with cols=1 initially; scheduleAutoColumns() bumps the
  // ``data-cols`` attribute up until content fits.
  const normCols = normalizeColumns(options.columns);
  const columns = normCols === "auto" ? 1 : normCols;
  const showColour = data.show_dot_color !== false;
  // Defaults off (see plugin.json), so this reads === true rather than the
  // !== false the default-on flags above use.
  const useSymbol = data.use_symbol_dot === true;
  // v0.4.2: per-content-type sizing knobs, clamped client-side (moved
  // from server.py's _coerce_scale — options carries the raw slider
  // value). The CSS custom props flow into rail-title / time-chip /
  // rail-sub / day-row padding so the user's cell config drives what
  // feels tight vs spacious without touching the widget CSS.
  const eventTitleScale = clampScale(options.event_title_scale, 1.0, 0.01, 10.0);
  const timeScale = clampScale(options.event_time_scale, 1.0, 0.01, 10.0);
  const locScale = clampScale(options.event_location_scale, 0.9, 0.01, 10.0);
  const rowPad = clampScale(options.day_row_padding_em, 0.5, 0.0, 3.0);
  const dashboardTitleScale = clampScale(options.title_scale, 1.0, 0.01, 10.0);
  const headerScale = clampScale(options.header_scale, 1.0, 0.01, 10.0);
  const labelStyle = ["short", "minimal", "full"].includes(options.date_label_style) ? options.date_label_style : "short";
  const weekMode = normalizeWeekNumber(options.week_number);
  // Server-side option (the "short" styles trim the string before the
  // keyword filters run), forwarded in the payload like show_location.
  const locStyle = ["full", "line", "short_wrap", "short"].includes(data.location_style) ? data.location_style : "full";
  const contLabel = cssString(t("continued", "cont."));
  let prevWeek = null;
  const styleAttr = `--event-title-scale:${eventTitleScale};--time-scale:${timeScale};--loc-scale:${locScale};--row-pad:${rowPad}em;--dashboard-title-scale:${dashboardTitleScale};--header-scale:${headerScale};--cont-label:&quot;${escapeHtml(contLabel)}&quot;;`;
  return `
    ${styles(fontFamily)}
    <div class="frame" data-cols="${columns}" data-loc="${locStyle}" style="${styleAttr}">
      ${titleHtml}
      <div class="body">
        <div class="days">
          ${days.map((d) => {
            const week = weekLabel(d, weekMode, prevWeek, t);
            const date = parseDateIso(d && d.date_iso);
            if (date) prevWeek = isoWeek(date);
            return renderDay(d, tf, showColour, useSymbol, labelStyle, t, locale, week);
          }).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderTitle(truncated, t) {
  const truncatedPill = truncated
    ? `<span class="title-pill" title="${escapeAttr(t("capped_help", "More events were available; raise \"Max events across the whole agenda\" to show them."))}">${escapeHtml(t("capped", "capped"))}</span>`
    : "";
  return `
    <div class="title">
      <i class="ph-bold ph-list-bullets" aria-hidden="true"></i>
      <span class="title-text">${escapeHtml(t("title", "Schedule"))}</span>
      ${truncatedPill}
    </div>
  `;
}

// The server spreads a multi-day all-day event into every covered day's
// bucket and stamps each copy with ``end_date`` (the true inclusive last
// local date, not clamped to the window). Badge the copies that carry on
// past the day they're rendered under: "-> AUG 20", with the month in
// the panel's locale like the day headers.
//
// v0.5.2 to 0.7.1 inferred the span by scanning every day for copies
// with equal summary/colour/location, drawing the label only on the
// first index and hiding it everywhere else. Two bugs: every later day
// of a holiday rendered blank, and two same-titled all-day events on
// non-adjacent days (a weekly "Bin day") collapsed into one bogus span.
export function allDayEndBadge(ev, dateIso, locale) {
  const end = ev && typeof ev.end_date === "string" ? ev.end_date : "";
  // Both are YYYY-MM-DD, so a string compare is a date compare.
  if (!end || !dateIso || end <= dateIso) return "";
  const date = parseDateIso(end);
  if (!date) return "";
  const month = dayLabel({ date_iso: end }, "month", "short", locale);
  return `${month} ${date.getDate()}`;
}

export function renderDay(day, timeFormat, showColour, useSymbol, labelStyle, t, locale, week = "") {
  const events = Array.isArray(day.events) ? day.events : [];
  const allDay = events.filter((e) => e && e.all_day === true);
  const timed = events.filter((e) => e && e.all_day !== true);
  const allDayHtml = allDay.length
    ? `<div class="all-day-stack">${allDay.map((e) => renderAllDay(e, showColour, day.date_iso, t, locale)).join("")}</div>`
    : "";
  const timedHtml = timed.length
    ? `<div class="rail">${timed.map((e) => renderTimed(e, timeFormat, showColour, useSymbol, t, locale)).join("")}</div>`
    : "";
  const empty = !allDay.length && !timed.length
    ? `<div class="day-empty">${escapeHtml(t("no_events_day", "(no events)"))}</div>`
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
        <span class="day-dow">${escapeHtml(dayLabel(day, "weekday", labelStyle, locale))}</span>
        <span class="day-meta">${week ? `<span class="day-week">${escapeHtml(week)}</span>` : ""}<span class="day-month">${escapeHtml(dayLabel(day, "month", labelStyle, locale))}</span></span>
      </header>
      ${allDayHtml}
      ${timedHtml}
      ${empty}
    </section>
  `;
}

function renderAllDay(ev, showColour, dateIso, t, locale) {
  const title = escapeHtml(ev.summary || t("untitled", "(untitled)"));
  const bg = showColour && ev.colour ? ev.colour : "var(--text-primary, #1B1A16)";
  const styleAttr = `style="background:${escapeAttr(bg)}"`;
  const endLabel = allDayEndBadge(ev, dateIso, locale);
  const spanBadge = endLabel
    ? `<span class="all-day-span">&rarr; ${escapeHtml(endLabel)}</span>`
    : "";
  return `
    <div class="all-day" ${styleAttr}>
      <span class="all-day-label">${escapeHtml(t("all_day", "ALL DAY"))}</span>
      <span class="all-day-title">${title}</span>
      ${spanBadge}
    </div>
  `;
}

function renderTimed(ev, timeFormat, showColour, useSymbol, t, locale) {
  const title = escapeHtml(ev.summary || t("untitled", "(untitled)"));
  const startChip = formatChipLabel(ev.start_local, timeFormat, locale);
  const endLabel = formatChipLabel(ev.end_local, timeFormat, locale);
  // v0.10.0: the server flags events that have already ended when
  // keep_past_today is on. Those rows drop the feed colour and paint
  // in muted ink so the eye lands on what is still to come.
  const past = ev.past === true;
  const bg = past
    ? "var(--text-muted, var(--muted, #8A8678))"
    : showColour && ev.colour ? ev.colour : "var(--text-primary, #1B1A16)";
  // ev.colour is already None-ed out server-side when show_dot_color is off,
  // so the symbols collapse to the fallback bullet along with the chip fill.
  const node = useSymbol ? colorToSymbol(ev.colour) : FALLBACK_SYMBOL;
  const chipStyle = `style="background:${escapeAttr(bg)}"`;
  // The location gets its own span so the one-line location styles can
  // clip it with an ellipsis while the "until" part stays whole.
  const untilPart = endLabel ? `<span class="rail-until">${escapeHtml(t("until", "until"))} ${escapeHtml(endLabel)}</span>` : "";
  const locPart = ev.location ? `<span class="rail-loc">${escapeHtml(ev.location)}</span>` : "";
  const sub = [untilPart, locPart].filter(Boolean).join(`<span class="rail-sep">·</span>`);
  return `
    <div class="rail-row${past ? " is-past" : ""}">
      <div class="time-gutter">
        <span class="time-chip" ${chipStyle}>${escapeHtml(startChip || "")}</span>
      </div>
      <div class="rail-spine"><span class="rail-node">${node}</span></div>
      <div class="rail-content">
        <div class="rail-title">${title}</div>
        ${sub ? `<div class="rail-sub">${sub}</div>` : ""}
      </div>
    </div>
  `;
}

// 12h keeps the compact "3pm" / "3:30pm" chip shape; the am/pm marker
// comes from Intl's dayPeriod for the panel locale when it's short
// enough to fit the chip, else the English suffix. 24h is locale-neutral.
export function formatChipLabel(iso, format, locale) {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const h24 = d.getHours();
  const m = d.getMinutes();
  if (format === "12h") {
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const suffix = dayPeriod(d, locale) || (h24 < 12 ? "am" : "pm");
    return m === 0 ? `${h12}${suffix}` : `${h12}:${pad2(m)}${suffix}`;
  }
  return `${pad2(h24)}:${pad2(m)}`;
}

function dayPeriod(date, locale) {
  if (!locale || isEnglish(locale)) return "";
  try {
    const parts = new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: true }).formatToParts(date);
    const dp = parts.find((p) => p.type === "dayPeriod");
    const text = dp ? dp.value.trim().toLowerCase() : "";
    return text && text.length <= 4 ? text : "";
  } catch {
    return "";
  }
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
        /* Anchored to the same --w-font-base every other Spectra widget
           uses (spectra-tokens.css), so this widget's text tracks the
           shared fluid-size baseline instead of inventing its own. The
           /2.4 ratio keeps the existing per-column shrink (cols
           1->base, 2->0.875x, 3->0.833x, 4->0.771x) since 2.4 was the
           1-column baseline of the old formula. */
        font-size: calc(var(--w-font-base, clamp(14px, 7cqmin, 28px)) * var(--f-scale, 2.4) / 2.4);
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
        font-size: calc(0.78em * var(--dashboard-title-scale, 1));
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
      .day-header--continuation .day-month,
      .day-header--continuation .day-week {
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
        content: var(--cont-label, "cont.");
        font-size: 0.62em;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted, var(--muted, #8A8678));
        margin-left: 0.35em;
        opacity: 0.8;
      }

      .day-header {
        display: flex;
        /* A header too wide for a narrow column used to overflow and
           paint into the neighbouring column; wrapping drops the muted
           week / month labels onto a second right-aligned line instead. */
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.1em 0.55em;
        border-bottom: 3px solid var(--text-primary, #1B1A16);
        padding-bottom: 0.15em;
      }
      .day-num {
        font-size: calc(2.3em * var(--header-scale, 1));
        font-weight: 800;
        line-height: 0.82;
      }
      .day.is-today .day-num {
        color: var(--accent-1, var(--accent, #C24F2C));
      }
      .day-dow {
        font-size: calc(0.95em * var(--header-scale, 1));
        font-weight: 800;
        letter-spacing: 0.06em;
      }
      /* Month plus the optional ISO week badge (week_number option),
         one right-aligned unit so they wrap together when the header
         is too wide for its column. */
      .day-meta {
        margin-left: auto;
        display: inline-flex;
        align-items: baseline;
        gap: 0.7em;
      }
      .day-month {
        font-size: calc(0.78em * var(--header-scale, 1));
        font-weight: 700;
        color: var(--text-muted, var(--muted, #8A8678));
      }
      .day-week {
        font-size: calc(0.78em * var(--header-scale, 1));
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--text-muted, var(--muted, #8A8678));
      }

      .all-day-stack {
        display: flex;
        flex-direction: column;
        gap: 0.24em;
        /* v0.4.10: bumped from 0.44em so the first row breathes
           away from the day-header's thick border-bottom. */
        margin-top: 0.7em;
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
      .all-day-span {
        font-size: 0.72em;
        opacity: 0.85;
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .all-day-title {
        flex: 1 1 auto;
        /* .all-day sets font-size:0.82em to keep the ALL DAY pill + row
           padding compact, but that also shrank the title below the timed
           .rail-title at the same slider value (issue #4). Divide the 0.82
           back out so the title matches timed event titles exactly, while the
           pill and padding stay compact. */
        font-size: calc(1em / 0.82 * var(--event-title-scale, 1));
        text-overflow: ellipsis;
        overflow: hidden;
      }

      .rail {
        display: flex;
        flex-direction: column;
        /* v0.4.10: matches .all-day-stack; keeps a consistent gap
           between the day-header rule and the first event row. */
        margin-top: 0.7em;
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
      /* v0.6.0: the node is a glyph rather than a CSS circle, so the old
         2px --surface border that used to knock the spine out from behind
         the dot is gone. The --surface background does that job instead,
         otherwise the spine draws straight through the hollow shapes. The
         box is sized in em and centred with a 1px nudge for the spine's
         own width, so it stays on the rail as the title-scale slider moves.
         The font stack is pinned because the theme face may not carry the
         geometric shapes, and a missing glyph renders as tofu. */
      .rail-node {
        position: absolute;
        left: calc(-0.5em + 1px);
        top: 0.1em;
        width: 1em;
        height: 1em;
        line-height: 1;
        text-align: center;
        background: var(--surface, #FCFBF7);
        font-family: "DejaVu Sans", "Noto Sans Symbols 2", "Segoe UI Symbol", sans-serif;
        font-size: 0.9em;
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
        font-size: calc(1em * var(--event-title-scale, 1));
      }
      .rail-sub {
        font-size: calc(0.72em * var(--loc-scale, 0.9) / 0.9);
        font-weight: 600;
        color: var(--text-muted, var(--muted, #8A8678));
        margin-top: 0.06em;
      }
      .rail-sep { margin: 0 0.3em; }
      /* keep_past_today: an event that has already ended keeps its row
         but in muted ink, with a lighter title weight, so it reads as
         done without vanishing. The chip fill is switched to the muted
         colour in renderTimed. */
      .rail-row.is-past .rail-title {
        color: var(--text-muted, var(--muted, #8A8678));
        font-weight: 600;
      }
      .rail-row.is-past .rail-node {
        color: var(--text-muted, var(--muted, #8A8678));
      }
      /* location_style "line" / "short": keep the sub line to one row and
         trim the location with an ellipsis. The "until" part is fixed
         width; the location takes what's left. "full" and "short_wrap" wrap. */
      .frame[data-loc="line"] .rail-sub,
      .frame[data-loc="short"] .rail-sub {
        display: flex;
        align-items: baseline;
        white-space: nowrap;
      }
      .frame[data-loc="line"] .rail-until,
      .frame[data-loc="short"] .rail-until,
      .frame[data-loc="line"] .rail-sep,
      .frame[data-loc="short"] .rail-sep {
        flex: 0 0 auto;
      }
      .frame[data-loc="line"] .rail-loc,
      .frame[data-loc="short"] .rail-loc {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
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

      /* xs / sm support: multi-column agenda doesn't fit a 180-400px
         wide cell, so force single column regardless of the JS-computed
         data-cols, and drop secondary content the way calendar_day /
         calendar_three_day already do at the same breakpoints. */
      @container (max-width: 400px) {
        .days { column-count: 1 !important; }
      }
      @container (max-width: 360px) {
        .title-pill { display: none; }
        .rail-sub { display: none; }
        .day-month { display: none; }
        .day-week { display: none; }
        .all-day-label { display: none; }
      }
      @container (max-width: 240px) {
        .title { display: none; }
        .day-dow { display: none; }
        .day-num { font-size: 1.6em; }
        .rail-spine, .rail-node { display: none; }
        .rail-content { padding-left: 0; }
        .time-gutter { min-width: 2.4em; }
        /* Cap visible rows per day so a busy day doesn't blow out the
           tiny cell's height; matches the widgets.md convention of
           trimming list rows per size rather than shrinking every row. */
        .rail-row:nth-child(n+4) { display: none; }
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
