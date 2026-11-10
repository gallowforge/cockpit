package collect

import (
	"time"

	"github.com/gallowforge/vesper/internal/snapshot"
)

// The day line: one character per five minutes for the last 24 hours, so the
// UI can draw a real day of history and work out uptime from it. A slot keeps
// the worst state sampled in it, and a slot in which Vesper took no sample at
// all (it was stopped, or the Pi was off) stays "?": unknown, never "up".

// dayRank orders the beat letters by how bad they are. Up and off are equal:
// an intentionally stopped service is not a problem.
var dayRank = [256]int8{'u': 0, 'o': 0, '?': 1, 'd': 2, 'x': 3}

type dayLine struct {
	end   int64  // the newest slot, as a slot number since the Unix epoch
	marks []byte // oldest first, at most snapshot.DaySlots long
}

func daySlot(t time.Time) int64 { return t.Unix() / int64(snapshot.DaySlot/time.Second) }

// seedDay restores a line from a previous snapshot written at gen.
func seedDay(day string, gen time.Time) *dayLine {
	if day == "" || gen.IsZero() {
		return &dayLine{}
	}
	m := []byte(day)
	if len(m) > snapshot.DaySlots {
		m = m[len(m)-snapshot.DaySlots:]
	}
	return &dayLine{end: daySlot(gen), marks: m}
}

// mark records one sample taken at t and returns the line.
func (d *dayLine) mark(t time.Time, ch byte) string {
	s := daySlot(t)
	switch {
	case len(d.marks) == 0:
		d.marks = append(d.marks, ch)
		d.end = s
	case s > d.end:
		gap := s - d.end
		if gap >= snapshot.DaySlots { // nothing from the old line is still inside the day
			d.marks = d.marks[:0]
			gap = 1
		}
		for i := int64(1); i < gap; i++ {
			d.marks = append(d.marks, '?')
		}
		d.marks = append(d.marks, ch)
		d.end = s
	default: // the same slot, or the clock stepped back: fold into the newest slot
		last := &d.marks[len(d.marks)-1]
		if dayRank[ch] >= dayRank[*last] {
			*last = ch
		}
	}
	if n := len(d.marks) - snapshot.DaySlots; n > 0 {
		d.marks = d.marks[n:]
	}
	return string(d.marks)
}

func (c *Collector) dayMark(id, beats string, now time.Time) string {
	d := c.day[id]
	if d == nil {
		d = &dayLine{}
		c.day[id] = d
	}
	ch := byte('?')
	if beats != "" {
		ch = beats[len(beats)-1]
	}
	return d.mark(now, ch)
}
