// Backups: is my data safe, and has a restore actually been proven?
import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { BackupSet, Level, Snapshot } from '../types'
import { ago, bytes, clock, dateTime, dayLabel, duration, inAbout, ms, pct, plural } from '../format'
import { Btn, Empty, Figures, Glyph, Meter, PageHead, Runs, Section, Seg, Spark, State } from '../components/ui'
import { IconBack, IconChevron } from '../components/icons'

function growth(b: BackupSet): string | null {
  const a = b.archives.slice().sort((x, y) => ms(x.time) - ms(y.time))
  if (a.length < 2 || !a[0].bytes) return null
  const first = a.find((x) => ms(x.time) >= ms(a[a.length - 1].time) - 30 * 86400e3) ?? a[0]
  if (!first.bytes) return null
  const d = ((a[a.length - 1].bytes - first.bytes) / first.bytes) * 100
  if (Math.abs(d) < 0.5) return 'steady'
  return `${d > 0 ? '+' : ''}${d.toFixed(Math.abs(d) >= 10 ? 0 : 1)}% this month`
}

function nextBackup(snap: Snapshot) {
  return snap.timers.find((t) => /backup\.service$/.test(t.activates) && !/restore|drill/.test(t.activates))
}

const TYPE: Record<string, string> = { dir: 'Directory', sqlite: 'SQLite', files: 'Files', 'ha-link': 'Home Assistant' }
const typeName = (t: string) => TYPE[t] ?? t

export function BackupsView(p: ViewProps) {
  const { snap, now, route } = p
  const [night, setNight] = useState<number | null>(null)
  const [week, setWeek] = useState('0')
  if (route[1]) return <SetDetail {...p} name={route[1]} />
  const sets = snap.backups.sets
  const bad = sets.filter((b) => b.level !== 'ok')
  const runs = snap.backups.runs.slice(0, 30)
  const shown = runs.slice().reverse()
  const pick = night ?? shown.length - 1
  const sel = shown[pick]
  const nb = nextBackup(snap)
  const drill = snap.drill.runs[0]
  const dw = snap.drill.runs[Number(week)]
  const lv = (l: Level) => (l === 'info' ? undefined : l)
  return (
    <div>
      <PageHead title="Backups" sub={bad.length
        ? <State level="crit">{plural(bad.length, 'set')} not verified in time</State>
        : <>Every set is written, read back and checked each night. A restore drill proves them once a week.</>} />
      <Figures items={[
        { label: 'Verified in time', value: sets.length - bad.length, unit: `/ ${sets.length}`, caption: bad.length ? bad.map((b) => b.name).join(', ') : 'every set inside its limit', level: lv(snap.backups.level) },
        { label: 'Newest archives', value: bytes(snap.backups.bytes).split(' ')[0], unit: bytes(snap.backups.bytes).split(' ')[1], caption: 'all sets together' },
        { label: 'Last run', value: runs[0] ? clock(runs[0].start) : '—', caption: runs[0] ? `${dayLabel(runs[0].start, now)}, took ${duration(runs[0].start, runs[0].end)}` : 'no run in the journal', level: runs[0]?.result === 'failed' ? 'crit' : undefined },
        { label: 'Restore drill', value: drill ? drill.passed : '—', unit: drill ? `/ ${drill.passed + drill.failed}` : undefined, caption: drill ? `restored ${ago(drill.end, now)}` : 'none has run yet', level: lv(snap.drill.level) },
      ]} />

      <Section title="Sets" aside={nb?.next ? <span class="num">next run {clock(nb.next)} · {inAbout(nb.next, now)}</span> : undefined}>
        <div class="rows">
          {sets.map((b) => {
            const age = b.last_ok ? now - ms(b.last_ok) : Infinity
            const used = b.max_age_h ? pct(age, b.max_age_h * 3600e3) : 100
            const g = growth(b)
            return (
              <a key={b.name} class={`row bk-row ${b.level}`} href={`#/backups/${encodeURIComponent(b.name)}`}>
                <Glyph level={b.level === 'info' ? 'ok' : b.level} size={14} />
                <span class="main-col">
                  <span class="ttl"><span>{b.name}</span></span>
                  <span class="sub">{typeName(b.type)} · keeps {b.keep} · {b.level === 'ok' ? `verified ${b.last_ok ? ago(b.last_ok, now) : 'never'}` : b.detail}</span>
                </span>
                <span class="bk-age">
                  <Meter pct={used} level={b.level !== 'ok' ? b.level : used > 80 ? 'warn' : 'ok'} label={`Age against the ${b.max_age_h}-hour limit`} />
                  <span class="muted num" style={{ fontSize: '11px' }}>{isFinite(age) ? `${Math.round(age / 3600e3)} of ${b.max_age_h} h` : `limit ${b.max_age_h} h`}</span>
                </span>
                <span class="end stack">{bytes(b.bytes)}<small>{g ?? ''}</small></span>
                <IconChevron size={14} />
              </a>
            )
          })}
        </div>
        <p class="sec-note">The bar is each set's age against its own limit; past the limit the set counts as not verified.</p>
      </Section>

      <Section title="Nightly runs" aside={<span>the last {shown.length} nights</span>}>
        <div class="panel">
          {shown.length === 0 ? <Empty left>No backup run in the journal yet.</Empty> : (
            <>
              <Runs label="Nightly backup runs" items={shown.map((r) => ({ level: r.result === 'failed' ? 'crit' : r.result === 'success' ? 'ok' : 'info', label: `${dateTime(r.start)}: ${r.result}` }))} selected={pick} onPick={setNight} />
              {sel && (
                <p class="run-sel">
                  <Glyph level={sel.result === 'failed' ? 'crit' : sel.result === 'success' ? 'ok' : 'info'} size={14} />
                  <span><b>{dateTime(sel.start)}</b> · took {duration(sel.start, sel.end)}{sel.summary ? <> · {sel.summary}</> : ''}</span>
                </p>
              )}
            </>
          )}
        </div>
      </Section>

      <Section title="Restore drill" aside={snap.drill.runs.length > 1 && (
        <Seg label="Drill" value={week} onChange={setWeek} options={snap.drill.runs.slice(0, 5).map((d, i) => [String(i), i === 0 ? 'Latest' : new Date(ms(d.end)).toLocaleDateString([], { day: 'numeric', month: 'short' })] as const)} />
      )}>
        {!dw ? <Empty left>No restore drill in the journal yet. Until one has run, no backup has been proven restorable.</Empty> : (
          <div class="panel">
            <p style={{ marginBottom: '12px' }}>
              {dw.failed ? <State level="crit">{dw.failed} of {dw.passed + dw.failed} sets failed to restore</State> : <span class="strong">All {dw.passed} sets restored into memory and compared with the live data.</span>}
              <span class="muted"> {dateTime(dw.end)} · took {duration(dw.start, dw.end)}</span>
            </p>
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
  if (!b) return <Empty>No backup set called <code>{name}</code>. <a class="linklike" href="#/backups">All sets</a></Empty>
  const arch = b.archives.slice().sort((x, y) => ms(x.time) - ms(y.time))
  const drills = snap.drill.runs.map((d) => ({ d, r: d.results.find((x) => x.set === b.name) })).filter((x) => x.r)
  const passed = drills.filter((x) => x.r!.ok).length
  const rb = snap.runbooks.find((r) => (r.match ?? []).some((m) => m === 'backup-' + b.name || m === 'backups' || m === 'backup-*'))
  const g = growth(b)
  return (
    <div>
      <a class="back" href="#/backups"><IconBack size={14} /> Backups</a>
      <PageHead title={b.name} sub={<>{typeName(b.type)} set, keeps {b.keep}. {b.level === 'ok' ? <>Verified {b.last_ok ? ago(b.last_ok, now) : 'never'}.</> : <State level={b.level}>{b.detail}</State>}</>}
        aside={rb && <Btn href={`#/runbooks/${encodeURIComponent(rb.id)}`} primary>How to restore it</Btn>} />
      <Figures items={[
        { label: 'Newest archive', value: bytes(b.bytes).split(' ')[0], unit: bytes(b.bytes).split(' ')[1], caption: g ?? 'one archive so far' },
        { label: 'Archives kept', value: arch.length, unit: `/ ${b.keep}`, caption: arch[0] ? `since ${dateTime(arch[0].time)}` : 'none yet' },
        { label: 'Age limit', value: b.max_age_h, unit: 'h', caption: 'older counts as not verified' },
        { label: 'Drills restored it', value: drills.length ? passed : '—', unit: drills.length ? `/ ${drills.length}` : undefined, caption: drills[0] ? `last ${dayLabel(drills[0].d.end, now).toLowerCase()}` : 'no drill yet', level: passed < drills.length ? 'crit' : undefined },
      ]} />
      <Section title="Archive size">
        <div class="panel">
          {arch.length < 2 ? <Empty left>Not enough archives to draw yet.</Empty> : (
            <>
              <Spark values={arch.map((a) => a.bytes)} w={720} h={88} fluid grid />
              <div class="chart-lbl"><span>{dateTime(arch[0].time)}</span><span>{dateTime(arch[arch.length - 1].time)}</span></div>
            </>
          )}
        </div>
      </Section>
      {b.checks && Object.keys(b.checks).length > 0 && (
        <Section title="Checks on the newest archive">
          <dl class="kv">
            {Object.entries(b.checks).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/^rows_/, 'Rows in ').replace('members', 'Files in the archive')}</dt><dd class="num">{v.toLocaleString()}</dd></Fragment>)}
          </dl>
        </Section>
      )}
      {drills.length > 0 && (
        <Section title="Restore drills">
          <div class="rows">
            {drills.map(({ d, r }) => (
              <div key={d.end} class="row">
                <Glyph level={r!.ok ? 'ok' : 'crit'} size={14} />
                <span class="main-col"><span class="ttl"><span>{dateTime(d.end)}</span></span><span class="sub">{r!.ok ? 'restored and compared' : r!.detail}</span></span>
                <span />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
