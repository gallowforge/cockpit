import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { BackupSet, Run } from '../types'
import { ago, bytes, clock, dateTime, duration, ms, pct, until } from '../format'
import { Card, Dot, Meter, PageHead, Pill, RunStrip, RunbookLink, Stat } from '../components/ui'
import { IconShield } from '../components/icons'

export function BackupsView({ snap, now }: ViewProps) {
  const b = snap.backups
  const ok = b.sets.filter((s) => s.level === 'ok').length
  const run = b.runs[0]
  const timer = snap.timers.find((t) => t.activates === run?.unit || /homelab-backup\.timer$/.test(t.unit))
  const [picked, setPicked] = useState<Run | null>(null)
  const shown = picked ?? run
  const rbId = snap.runbooks.find((r) => r.match?.some((m) => m === 'backups'))?.id
  const failed30 = b.runs.filter((r) => r.result === 'failed').length

  return (
    <div>
      <PageHead
        title="Backups"
        sub="Every set is written, verified, and only then are old archives pruned. The drill restores the newest archive of each set every week."
        right={<RunbookLink id={rbId} title="Restore a backup" />}
      />
      <div class="stats-row">
        <Stat label="Sets verified" value={`${ok}/${b.sets.length}`} level={b.level} sub={b.level === 'ok' ? 'all within their age limit' : 'see below'} />
        <Stat label="Newest archives" value={bytes(b.bytes)} sub="one per set, summed" />
        <Stat label="Last run" value={run ? clock(run.start) : '—'} sub={run ? `${run.result} · took ${duration(run.start, run.end)}` : 'no run in the journal'} level={run?.result === 'failed' ? 'crit' : undefined} />
        <Stat label="Next run" value={timer?.next ? until(timer.next, now).replace('in ', '') : '—'} sub={timer?.next ? dateTime(timer.next) : ''} />
        <Stat label="Failed runs" value={`${failed30}`} sub={`of the last ${b.runs.length}`} level={failed30 ? 'warn' : undefined} />
      </div>

      <Card title="Sets" class="mt">
        <div class="set-table" role="table">
          <div class="set-head" role="row">
            <span>Set</span><span>Verified</span><span>Freshness</span><span>Size</span><span>Archives kept</span><span>Checks</span>
          </div>
          {b.sets.map((s) => <SetRow key={s.name} s={s} now={now} />)}
        </div>
      </Card>

      <div class="two mt">
        <Card title={<>Nightly runs <span class="count">last {b.runs.length}</span></>}>
          <RunStrip runs={b.runs} n={30} onPick={setPicked} />
          {shown && (
            <div class={`run-detail r-${shown.result}`}>
              <div>
                <Dot level={shown.result === 'success' ? 'ok' : shown.result === 'failed' ? 'crit' : 'info'} size={8} />{' '}
                <b>{dateTime(shown.start)}</b> <span class="muted">· {shown.result} · {duration(shown.start, shown.end)}</span>
              </div>
              {shown.summary && <code class="run-summary">{shown.summary}</code>}
            </div>
          )}
          <Durations runs={b.runs} />
          <p class="hint">Tap a square for that night. Red means the engine refused to prune: the older archives were kept.</p>
        </Card>
        <DrillCard snap={snap} now={now} />
      </div>
    </div>
  )
}

function SetRow({ s, now }: { s: BackupSet; now: number }) {
  const ageH = s.last_ok ? (now - ms(s.last_ok)) / 3600000 : Infinity
  const used = isFinite(ageH) ? pct(ageH, s.max_age_h) : 100
  const sizes = s.archives.slice(0, 14).reverse()
  const peak = Math.max(1, ...sizes.map((a) => a.bytes))
  const low = Math.min(...sizes.map((a) => a.bytes))
  const checks = Object.entries(s.checks ?? {})
    .filter(([k]) => k !== 'members')
    .map(([k, v]) => `${k.replace(/^rows_/, '')} ${v}`)
  return (
    <div class={`set-row lv-${s.level}`} role="row">
      <span class="set-name"><Dot level={s.level} size={8} /> {s.name} <span class="set-type">{s.type}</span></span>
      <span>{s.last_ok ? ago(s.last_ok, now) : <Pill level="crit">never</Pill>}</span>
      <span class="set-fresh">
        <Meter value={100 - used} level={s.level !== 'ok' ? s.level : used > 75 ? 'warn' : 'ok'} />
        <span class="muted">limit {s.max_age_h}h</span>
      </span>
      <span class="mono">{bytes(s.bytes)}</span>
      <span class="set-arch" title={`${s.archives.length} of ${s.keep} kept`}>
        <span class="arch-bars" aria-hidden="true">
          {sizes.map((a) => {
            // scale between the smallest and largest kept archive, so growth shows
            const span = peak - low
            const h = span > 0 ? 6 + ((a.bytes - low) / span) * 14 : 14
            return <i key={a.time} style={{ height: `${h}px` }} />
          })}
        </span>
        <span class="muted">{s.archives.length}/{s.keep}</span>
      </span>
      <span class="muted set-checks">{checks.join(' · ') || (s.checks?.members ? `${s.checks.members} members` : '—')}</span>
    </div>
  )
}

function Durations({ runs }: { runs: Run[] }) {
  const list = runs.slice(0, 30).reverse()
  const secs = list.map((r) => Math.max(0, (ms(r.end) - ms(r.start)) / 1000))
  const peak = Math.max(1, ...secs)
  if (!list.length) return null
  return (
    <>
      <div class="durations" aria-label="How long each night's run took">
        {list.map((r, i) => (
          <i key={r.start} class={r.result === 'failed' ? 'bad' : ''} style={{ height: `${(secs[i] / peak) * 100}%` }}
            title={`${new Date(r.start).toLocaleDateString()}: ${Math.round(secs[i])} s`} />
        ))}
      </div>
      <div class="dur-axis"><span>run time, oldest left</span><span>longest {Math.round(peak / 60)}m {Math.round(peak % 60)}s</span></div>
    </>
  )
}

function DrillCard({ snap, now }: { snap: ViewProps['snap']; now: number }) {
  const runs = snap.drill.runs
  const [i, setI] = useState(0)
  const r = runs[i]
  return (
    <Card title={<>Restore drill <span class="count">{runs.length ? `${runs.length} weeks` : 'none yet'}</span></>} icon={<IconShield size={16} />}>
      {!r ? (
        <p class="muted">No drill in the journal yet.</p>
      ) : (
        <>
          <div class="drill-tabs">
            {runs.slice(0, 6).map((d, j) => (
              <button key={d.start} type="button" class={`wk-tab ${d.failed ? 'bad' : 'good'}${i === j ? ' on' : ''}`} onClick={() => setI(j)}>
                {new Date(d.start).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>
          <div class="drill-head">
            <span class={r.failed ? 'lv-text-crit' : 'lv-text-ok'}><b>{r.passed} passed, {r.failed} failed</b></span>
            <span class="muted"> · {ago(r.end, now)} · {duration(r.start, r.end)}, unpacked in RAM and compared with live</span>
          </div>
          <ul class="drill-list">
            {r.results.map((x) => (
              <li key={x.set} class={x.ok ? 'ok' : 'bad'}>
                <span class="drill-mark">{x.ok ? 'PASS' : 'FAIL'}</span>
                <span class="drill-set">{x.set}</span>
                <span class="drill-detail">{x.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
