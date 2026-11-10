package collect

import (
	"strings"
	"testing"
	"time"

	"github.com/gallowforge/cockpit/internal/snapshot"
)

func TestDayLineKeepsTheWorstStatePerSlot(t *testing.T) {
	t0 := time.Date(2026, 3, 10, 7, 40, 0, 0, time.UTC) // a slot boundary
	var d dayLine
	d.mark(t0, 'u')
	d.mark(t0.Add(20*time.Second), 'x')
	if got := d.mark(t0.Add(40*time.Second), 'u'); got != "x" {
		t.Fatalf("a down sample inside a slot must stay visible, got %q", got)
	}
	if got := d.mark(t0.Add(5*time.Minute), 'u'); got != "xu" {
		t.Fatalf("next slot: got %q", got)
	}
}

func TestDayLineMarksTimeWithoutSamplesUnknown(t *testing.T) {
	t0 := time.Date(2026, 3, 10, 7, 40, 0, 0, time.UTC)
	var d dayLine
	d.mark(t0, 'u')
	if got := d.mark(t0.Add(16*time.Minute), 'u'); got != "u??u" {
		t.Fatalf("three slots were skipped, two are unknown: got %q", got)
	}
}

func TestDayLineHoldsOneDay(t *testing.T) {
	t0 := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	var d dayLine
	var got string
	for i := 0; i < snapshot.DaySlots+10; i++ {
		got = d.mark(t0.Add(time.Duration(i)*snapshot.DaySlot), 'u')
	}
	if len(got) != snapshot.DaySlots {
		t.Fatalf("length %d, want %d", len(got), snapshot.DaySlots)
	}
	// a gap longer than the day starts the line again
	got = d.mark(t0.Add(72*time.Hour), 'x')
	if got != "x" {
		t.Fatalf("after a long gap: got %q", got)
	}
}

func TestDayLineSurvivesARestart(t *testing.T) {
	gen := time.Date(2026, 3, 10, 7, 41, 0, 0, time.UTC)
	d := seedDay(strings.Repeat("u", 10), gen)
	// the collector comes back ten minutes later: two empty slots, then the new sample
	if got := d.mark(gen.Add(10*time.Minute), 'u'); got != strings.Repeat("u", 10)+"?u" {
		t.Fatalf("got %q", got)
	}
	if got := seedDay("", gen).mark(gen, 'd'); got != "d" {
		t.Fatalf("an empty seed starts a new line, got %q", got)
	}
}
