import type { ViewProps } from '../app'
import type { Service } from '../types'
import { groupServices, uptimeOf } from '../derive'
import { ago } from '../format'
import { Beats, Dot, PageHead, Pill, RunbookLink, Sparkline } from '../components/ui'
import { IconExternal } from '../components/icons'

const stateWord: Record<Service['state'], string> = { up: 'Up', degraded: 'Degraded', down: 'Down', off: 'Off', unknown: 'Unknown' }

function stats(v: number[] = []) {
  const ok = v.filter((x) => x >= 0).sort((a, b) => a - b)
  if (!ok.length) return null
  const q = (p: number) => ok[Math.min(ok.length - 1, Math.floor(ok.length * p))]
  return { min: ok[0], med: q(0.5), p95: q(0.95), fails: v.length - ok.length }
}

export function Services({ snap, now, route }: ViewProps) {
  const groups = groupServices(snap.services)
  const live = snap.services.filter((s) => s.state !== 'off')
  const up = live.filter((s) => s.state === 'up').length
  const selected = route[1]
  return (
    <div>
      <PageHead
        title="Services"
        sub={<>{up} of {live.length} up · containers, systemd units and client-side probes, newest sample on the right</>}
        right={<div class="legend"><span><i class="b-up" />up</span><span><i class="b-deg" />degraded</span><span><i class="b-down" />down</span></div>}
      />
      {groups.map((g) => (
        <section class="svc-group" key={g.name}>
          <h2 class="group-title">{g.name}</h2>
          <div class="svc-table">
            {g.services.map((s) => (
              <ServiceRow key={s.id} s={s} now={now} open={selected === s.id} runbook={snap.runbooks.find((r) => r.id === s.runbook)?.title} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ServiceRow({ s, now, open, runbook }: { s: Service; now: number; open: boolean; runbook?: string }) {
  const st = stats(s.probe?.latencies)
  const uptime = uptimeOf(s.beats)
  return (
    <div class={`svc-item${open ? ' open' : ''} lv-${s.level}`} id={`svc-${s.id}`}>
      <a class="svc-line" href={open ? '#/services' : `#/services/${encodeURIComponent(s.id)}`}>
        <Dot level={s.level} size={9} pulse={s.level === 'crit'} />
        <div class="svc-id">
          <div class="svc-title">{s.title}</div>
          <div class="svc-sub">{s.note || s.image || s.kind}</div>
        </div>
        <div class="svc-detail">{s.detail}</div>
        <div class="svc-beats"><Beats beats={s.beats} n={60} height={24} /></div>
        <div class="svc-lat">
          {s.probe ? (
            <>
              <span class="mono">{s.probe.ok ? `${Math.round(s.probe.latency_ms)} ms` : s.probe.error}</span>
              <Sparkline values={s.probe.latencies ?? []} height={22} width={90} cls={s.probe.ok ? '' : 'bad'} />
            </>
          ) : (
            <span class="muted">no probe</span>
          )}
        </div>
        <Pill level={s.level}>{stateWord[s.state]}</Pill>
      </a>
      {open && (
        <div class="svc-more">
          <dl>
            <div><dt>Kind</dt><dd>{s.kind}{s.image ? ` · ${s.image}` : ''}</dd></div>
            {s.since && <div><dt>In this state</dt><dd>since {ago(s.since, now).replace(' ago', '')}</dd></div>}
            {s.restarts ? <div><dt>Restarts</dt><dd>{s.restarts}</dd></div> : null}
            {uptime !== null && <div><dt>Up in window</dt><dd>{uptime.toFixed(uptime === 100 ? 0 : 1)}% of {s.beats.length} samples</dd></div>}
            {s.probe && <div><dt>Probe</dt><dd class="mono">{s.probe.target}{s.probe.code ? ` → ${s.probe.code}` : ''}</dd></div>}
            {st && <div><dt>Latency</dt><dd>min {st.min.toFixed(1)} · median {st.med.toFixed(1)} · p95 {st.p95.toFixed(1)} ms{st.fails ? ` · ${st.fails} failed` : ''}</dd></div>}
            {s.probe?.cert_days !== undefined && <div><dt>Certificate</dt><dd>expires in {s.probe.cert_days} days</dd></div>}
          </dl>
          <div class="svc-actions">
            {s.url && (
              <a class="btn" href={s.url} target="_blank" rel="noopener noreferrer">
                Open {s.title} <IconExternal size={14} />
              </a>
            )}
            <RunbookLink id={s.runbook} title={runbook} />
          </div>
        </div>
      )}
    </div>
  )
}
