package web

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"sync"
	"time"
)

// Store holds the current snapshot document and wakes subscribers when it
// changes. The collector's file or the demo generator feeds it.
type Store struct {
	mu      sync.RWMutex
	body    []byte
	etag    string
	updated time.Time
	subs    map[chan struct{}]struct{}
}

func NewStore() *Store { return &Store{subs: map[chan struct{}]struct{}{}} }

// Set replaces the document. Identical content does not wake anyone.
func (s *Store) Set(body []byte, at time.Time) {
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	s.mu.Lock()
	if etag == s.etag {
		s.mu.Unlock()
		return
	}
	s.body, s.etag, s.updated = body, etag, at
	subs := make([]chan struct{}, 0, len(s.subs))
	for ch := range s.subs {
		subs = append(subs, ch)
	}
	s.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- struct{}{}:
		default: // already has a pending wake-up
		}
	}
}

// Get returns the document and its ETag.
func (s *Store) Get() ([]byte, string, time.Time) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.body, s.etag, s.updated
}

// Subscribe returns a channel that receives a value after each change.
func (s *Store) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

// Subscribers is the number of live streams.
func (s *Store) Subscribers() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.subs)
}

// WatchFile reloads path into the store whenever its size or mtime changes.
// A stat a second is the whole cost while nothing changes.
func (s *Store) WatchFile(ctx context.Context, path string, every time.Duration) {
	var lastMod time.Time
	var lastSize int64 = -1
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if info, err := os.Stat(path); err == nil && (info.ModTime() != lastMod || info.Size() != lastSize) {
			if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
				lastMod, lastSize = info.ModTime(), info.Size()
				s.Set(b, info.ModTime())
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
