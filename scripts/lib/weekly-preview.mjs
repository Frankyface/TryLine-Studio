const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function weeklyPreview(calendar) {
  const when = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: calendar.timeZone, weekday: 'short',
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(date))
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Domestic weekly packs · TryLine Studio</title><style>
*{box-sizing:border-box}body{margin:0;background:#0d1519;color:#f3f5ed;font:15px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px 24px}h1{font-size:40px}a{color:#b9f36b}small{color:#b9f36b;letter-spacing:1px}section{margin:30px 0;padding:24px;background:#142128;border:1px solid #2c3d43;border-radius:12px}h2{margin-top:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}article{padding:18px;border:1px solid #526067;border-radius:8px}p,li{color:#b5c4c7}li{font-size:13px}h3{margin:8px 0}</style>
<main><small>TRYLINE STUDIO / DOMESTIC DESK</small><h1>Week of ${escape(calendar.week)}</h1><p>Wednesday previews. Monday results, standings and analysis. Tuesday match timelines.<br>Posting timezone: ${escape(calendar.timeZone)}. These are preparation artifacts; publishing is not connected.</p>
<p><a href="calendar.csv">Download posting schedule CSV</a> · <a href="calendar.json">Download manifest</a></p>
${calendar.leagues.map((league) => `<section><h2>${escape(league.name)}</h2><p>${league.completedMatches} completed / ${league.recordedFixtures} recorded fixtures</p>
${league.warnings.length ? `<details open><summary>Coverage & readiness</summary><ul>${league.warnings.map((w) => `<li>${escape(w)}</li>`).join('')}</ul></details>` : ''}
<div class="grid">${calendar.packs.filter((p) => p.league === league.id).map((pack) => `<article><small>${escape(pack.format)} · ${pack.slides} slides</small><h3>${escape(league.slots.find((s) => s.kind === pack.kind).title)}</h3><p>${escape(when(pack.publishAt))}<br>${escape(pack.state)}</p>${pack.slides ? `<a href="${escape(pack.manifest.replace(/[^/]+$/, 'preview.html'))}">Open graphics →</a>` : '<p>No slides for this edition.</p>'}</article>`).join('')}</div></section>`).join('')}
</main></html>`
}
