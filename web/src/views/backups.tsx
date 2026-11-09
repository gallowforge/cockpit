// Backups: is my data safe, and has a restore actually been proven?
import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { BackupSet, Snapshot } from '../types'
import { ago, bytes, clock, dateTime, dayLabel, duration, ms, pct, plural, until } from '../format'
import { Dots, Empty, Figure, Glyph, Meter, PageHead, Section, Spark } from '../components/ui'
import { IconBack, IconChevron } from '../components/icons'

function growth(b: BackupSet): string | null {
  const a = b.archives.slice().sort((x, y) => ms(x.time) - ms(y.time))
  if (a.length < 2 || !a[0].bytes) return null
  const first = a.find((x) => ms(x.time) >= ms(a[a.length - 1].time) - 30 * 86400e3) ?? a[0]
  if (!first.bytes) return null
  const d = ((a[a.length - 1].bytes - first.bytes) / first.bytes) * 100
  if (Math.abs(d) < 0.5) return 'steady'
  return `${d > 0 ? '+' : ''}${d.toFixed(d > 10 || d < -10 ? 0 : 1)}% in a month`
}

function nextBackup(snap: Snapshot) {
  return snap.timers.find((t) => /backup\.service$/.test(t.activates) && !/restore|drill/.test(t.activates))
}

export function BackupsView(p: ViewProps) {
  const { snap, now, route } = p
  const [night, setNight] = useState<number | null>(null)
  const [week, setWeek] = useState(0)
  if (route[1]) return <SetDetail {...p} name={route[1]} />
  const sets = snap.backups.sets
  const verified = sets.map((b) => ms(b.last_ok)).filter(isFinite)
  const oldest = verified.length ? new Date(Math.min(...verified)).toISOString() : undefined
  const bad = sets.filter((b) => b.level !== 'ok')
  const runs = snap.backups.runs.slice(0, 30)
  const shown = runs.slice().reverse()
  const pick = night ?? shown.length - 1
  const sel = shown[pick]
  const nb = nextBackup(snap)
  const drill = snap.drill.runs[0]
  const dw = snap.drill.runs[week]
  return (
    <div>
      <PageHead title="Backups" sub={bad.length
        ? <span class="st-crit">{plural(bad.length, 'set')} not verified in time.</span>
        : <>Every set verified{oldest ? `, the oldest ${ago(oldest, now)}` : ''}. {drill ? `The drill restored ${drill.passed} of ${drill.passed + drill.failed} ${ago(drill.end, now)}.` : 'No restore drill has run yet.'}</>} />
      <div class="figs">
        <Figure value={`${sets.length - bad.length}`} unit={`of ${sets.length}`} caption="sets verified in time" level={bad.length ? 'crit' : undefined} />
        <Figure value={bytes(snap.backups.bytes)} caption="newest archives, all sets" />
        <Figure value={runs[0] ? clock(runs[0].start) : '—'} caption={runs[0] ? `last run, ${dayLabel(runs[0].start, now).toLowerCase()}` : 'no run in the journal'} level={runs[0]?.result === 'failed' ? 'crit' : undefined} />
        <Figure value={nb?.next ? clock(nb.next) : '—'} caption={nb?.next ? `next run, ${until(nb.next, now)}` : 'no backup timer found'} />
      </div>

      <Section title="Sets">
        <div class="rows">
          {sets.map((b) => {
            const age = ms(b.last_ok) ? now - ms(b.last_ok) : Infinity
            const used = b.max_age_h ? pct(age, b.max_age_h * 3600e3) : 0
            const lit = b.level === 'crit' ? ' lit lit-down' : b.level === 'warn' ? ' lit lit-attn' : ''
            const g = growth(b)
            return (
              <a key={b.name} class={`row set${lit}`} href={`#/backups/${encodeURIComponent(b.name)}`}>
                <span class="row-main">
                  <span class="row-title">{b.name}{b.level !== 'ok' && <Glyph level={b.level} size={13} />}</span>
                  <span class="row-sub">{b.type} · {b.level === 'ok' ? b.detail : <span class="st-crit">{b.detail}</span>}</span>
                </span>
                <span class="set-fresh"><Meter pct={used} level={b.level === 'ok' ? (used > 80 ? 'warn' : 'ok') : b.level} /><small>limit {b.max_age_h}h</small></span>
                <Spark values={b.archives.slice().sort((x, y) => ms(x.time) - ms(y.time)).map((a) => a.bytes)} w={90} h={22} />
                <span class="row-num">{bytes(b.bytes)}<small>{g ?? ''}</small></span>
                <IconChevron size={16} />
              </a>
            )
          })}
        </div>
      </Section>

      <Section title="Nightly runs" aside={<span class="muted">tap a night</span>}>
        <div class="pane pad">
          {shown.length === 0 ? <Empty>No backup run in the journal yet.</Empty> : (
            <>
              <Dots items={shown.map((r) => ({ level: r.result === 'failed' ? 'crit' : r.result === 'success' ? 'ok' : 'info', label: `${dateTime(r.start)}: ${r.result}` }))} selected={pick} onPick={setNight} />
              {sel && (
                <div class="run-sel">
                  <Glyph level={sel.result === 'failed' ? 'crit' : sel.result === 'success' ? 'ok' : 'info'} size={15} />
                  <span><b>{dateTime(sel.start)}</b>, took {duration(sel.start, sel.end)}{sel.summary ? <>: {sel.summary}</> : ''}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Section>

      <Section title="Restore drill" aside={snap.drill.runs.length > 1 && (
        <div class="seg">
          {snap.drill.runs.slice(0, 6).map((d, i) => (
            <button key={d.end} type="button" class={week === i ? 'on' : ''} onClick={() => setWeek(i)}>{i === 0 ? 'Latest' : new Date(ms(d.end)).toLocaleDateString([], { day: 'numeric', month: 'short' })}</button>
          ))}
        </div>
      )}>
        {!dw ? <Empty>No restore drill in the journal yet. The drill runs weekly; until one has run, no backup has been proven restorable.</Empty> : (
          <div class={`pane pad${dw.failed ? ' lit lit-down' : ''}`}>
            <p class="drill-sum">{dw.failed ? <span class="st-crit">{dw.failed} of {dw.passed + dw.failed} sets failed to restore.</span> : <>All {dw.passed} sets restored and checked.</>} <span class="muted">{dateTime(dw.end)}, took {duration(dw.start, dw.end)}.</span></p>
            <ul class="drill-grid">
              {dw.results.map((r) => (
                <li key={r.set} class={r.ok ? '' : 'bad'}>
                  <Glyph level={r.ok ? 'ok' : 'crit'} size={14} />
                  <span><b>{r.set}</b>{r.detail && <small>{r.detail}</small>}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  )
}

function SetDetail({ snap, now, name }: ViewProps & { name: string }) {
  const b = snap.backups.sets.find((x) => x.name === name)
  if (!b) return <Empty>No backup set called <code>{name}</code>. <a href="#/backups">All sets</a></Empty>
  const arch = b.archives.slice().sort((x, y) => ms(x.time) - ms(y.time))
  const drills = snap.drill.runs.map((d) => ({ d, r: d.results.find((x) => x.set === b.name) })).filter((x) => x.r)
  const passed = drills.filter((x) => x.r!.ok).length
  const rb = snap.runbooks.find((r) => (r.match ?? []).some((m) => m === 'backup-' + b.name || m === 'backups' || m === 'backup-*'))
  const g = growth(b)
  return (
    <div class="detail">
      <a class="back" href="#/backups"><IconBack size={16} /> Backups</a>
      <PageHead title={b.name} sub={<>{b.type} set, keeps {b.keep}. {b.level === 'ok' ? <>Verified {b.last_ok ? ago(b.last_ok, now) : 'never'}.</> : <span class="st-crit">{b.detail}.</span>}</>} />
      <div class="figs">
        <Figure value={bytes(b.bytes)} caption={g ? `newest archive, ${g}` : 'newest archive'} />
        <Figure value={`${arch.length}`} unit={`of ${b.keep}`} caption="archives kept" />
        <Figure value={`${b.max_age_h}h`} caption="age limit before it counts as stale" />
        <Figure value={drills.length ? `${passed}` : '—'} unit={drills.length ? `of ${drills.length}` : undefined} caption="drills restored it" level={passed < drills.length ? 'crit' : undefined} />
      </div>
      <Section title="Archive sizes">
        <div class="pane pad">
          {arch.length < 2 ? <Empty>Not enough archives to draw yet.</Empty> : (
            <>
              <Spark values={arch.map((a) => a.bytes)} w={600} h={80} />
              <div class="axis"><span>{dateTime(arch[0].time)}</span><span>{dateTime(arch[arch.length - 1].time)}</span></div>
            </>
          )}
        </div>
      </Section>
      {b.checks && Object.keys(b.checks).length > 0 && (
        <Section title="Checks on the newest archive">
          <dl class="facts pane">
            {Object.entries(b.checks).map(([k, v]) => <div key={k}><dt>{k.replace(/^rows_/, 'rows in ').replace('members', 'files in the archive')}</dt><dd>{v.toLocaleString()}</dd></div>)}
          </dl>
        </Section>
      )}
      {drills.length > 0 && (
        <Section title="Restore drills">
          <div class="rows">
            {drills.map(({ d, r }) => (
              <div key={d.end} class={`row static${r!.ok ? '' : ' lit lit-down'}`}>
                <Glyph level={r!.ok ? 'ok' : 'crit'} size={14} />
                <span class="row-main"><span class="row-title">{dateTime(d.end)}</span><span class="row-sub">{r!.ok ? 'restored and checked' : r!.detail}</span></span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {rb && (
        <Section title="To restore it">
          <a class="row" href={`#/runbooks/${encodeURIComponent(rb.id)}`}><span class="row-main"><span class="row-title">{rb.title}</span><span class="row-sub">Checklist</span></span><IconChevron size={16} /></a>
        </Section>
      )}
    </div>
  )
}
