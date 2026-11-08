import type { ViewProps } from '../app'
import { prioLevel } from '../derive'
import { ago, clock, plural } from '../format'
import { Card, Dot, PageHead, Pill, RunbookLink, Stat } from '../components/ui'
import { IconDrift, IconHeart, IconShield } from '../components/icons'

const stateWord: Record<string, string> = {
  differs: 'content differs', missing: 'missing on the host', mode: 'mode differs', owner: 'owner differs',
  'not-in-repo': 'listed but not in the repo', unreadable: 'unreadable',
}

export function DriftView({ snap, now }: ViewProps) {
  const d = snap.drift
  const hb = snap.heartbeat
  const h = snap.health
  const rb = snap.runbooks.find((r) => r.match?.includes('drift'))
  const clean = d.result === 'clean'
  return (
    <div>
      <PageHead
        title="Drift & checks"
        sub="Is the machine still what the repo says it is, is the dead-man switch being fed, and what did this morning's health check find?"
        right={<RunbookLink id={rb?.id} title={rb?.title} />}
      />

      <section class={`drift-hero lv-${clean ? 'ok' : d.level}`}>
        <div class="drift-icon"><IconDrift size={26} /></div>
        <div>
          <div class="drift-title">
            {clean ? 'No drift' : d.result === 'drift' ? `${plural(d.files.length + d.disabled_timers.length, 'difference')} from the repo` : 'Drift unknown'}
          </div>
          <div class="muted">
            {d.tracked} host files compared byte for byte, with mode and owner · checked {ago(d.checked, now)}
            {d.uncommitted > 0 && <> · <span class="lv-text-info">{plural(d.uncommitted, 'uncommitted change')}</span></>}
            {d.error && <> · <span class="lv-text-warn">{d.error}</span></>}
          </div>
        </div>
      </section>

      {(d.files.length > 0 || d.disabled_timers.length > 0) && (
        <Card title="Differences" class="mt">
          <ul class="drift-list">
            {d.files.map((f) => (
              <li key={f.path}>
                <Dot level="warn" size={8} />
                <code>{f.path}</code>
                <span class="drift-state">{stateWord[f.state] ?? f.state}</span>
                {f.note && <span class="muted">{f.note}</span>}
              </li>
            ))}
            {d.disabled_timers.map((t) => (
              <li key={t}>
                <Dot level="warn" size={8} />
                <code>{t}</code>
                <span class="drift-state">in the MANIFEST but not enabled</span>
                <span class="muted">lost at the next boot</span>
              </li>
            ))}
          </ul>
          <p class="hint">
            Decide which side is right: copy a good live file into <code>_host/</code> and commit, or run{' '}
            <code>sudo _host/install.sh --apply</code> to install the repo's version.
          </p>
        </Card>
      )}

      <div class="stats-row mt">
        <Stat label="Files tracked" value={`${d.tracked}`} sub="from _host/MANIFEST" />
        <Stat label="Uncommitted" value={`${Math.max(0, d.uncommitted)}`} sub="git status in the repo" level={d.uncommitted > 0 ? 'info' : undefined} />
        <Stat label="Disabled timers" value={`${d.disabled_timers.length}`} sub="should be enabled" level={d.disabled_timers.length ? 'warn' : undefined} />
      </div>

      <div class="two mt">
        <Card title="Dead-man switch" icon={<IconHeart size={16} />}>
          {hb.unit ? (
            <>
              <div class="big-figure">
                <span class={`lv-text-${hb.level}`}>{hb.pings_24h}</span>
                <span class="muted">/{hb.runs_24h} pings in 24 h</span>
              </div>
              <p class="muted">
                Last {hb.ok ? 'ping' : 'run'} {ago(hb.last, now)}.{' '}
                {hb.ok
                  ? 'The ping is withheld when the endpoint monitor is unhealthy or the health check stops running, so silence outside raises the alarm.'
                  : `Withheld: ${hb.reason}`}
              </p>
            </>
          ) : (
            <p class="muted">No heartbeat unit configured.</p>
          )}
        </Card>
        <Card title="Daily health check" icon={<IconShield size={16} />}>
          <p class="muted">
            {h.last ? <>Ran at {clock(h.last)} ({ago(h.last, now)}): {h.result}</> : 'Has not run yet.'}
          </p>
          <div class="cats cats-big">
            {h.categories.map((c) => (
              <span key={c.name} class={`cat ${c.open ? 'lv-' + prioLevel(c.prio ?? '') : ''}`}>
                {c.open ? <Dot level={prioLevel(c.prio ?? '')} size={6} /> : null}
                {c.name}
                {c.open && c.prio && <Pill level={prioLevel(c.prio)}>{c.prio}</Pill>}
              </span>
            ))}
          </div>
          <p class="hint">A category lights up while its alert is open, and clears with the all-clear.</p>
        </Card>
      </div>

      <Card title="Collector" class="mt">
        <div class="sources">
          {snap.sources.map((s) => (
            <div key={s.name} class="source">
              <Dot level={s.ok ? 'ok' : 'warn'} size={7} />
              <span>{s.name}</span>
              <span class="muted mono">{s.duration_ms.toFixed(0)} ms</span>
              {s.error && <span class="lv-text-warn source-err">{s.error}</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
