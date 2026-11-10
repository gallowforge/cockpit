//go:build js && wasm

// Command vesper-wasm is the generator behind `vesper demo`, built for a browser.
// The live demo page runs it instead of a server: the same code makes the same
// synthetic homelab, at the time the page hands it.
package main

import (
	"encoding/json"
	"syscall/js"
	"time"

	"github.com/gallowforge/vesper/internal/demo"
)

func main() {
	js.Global().Set("vesperDemo", js.ValueOf(map[string]any{
		// snapshot(scenario, unixMillis) returns the state as the JSON the
		// server would send, or "" if it cannot be made.
		"snapshot": js.FuncOf(func(_ js.Value, args []js.Value) any {
			if len(args) < 2 {
				return ""
			}
			g := &demo.Generator{Scenario: args[0].String()}
			b, err := json.Marshal(g.Snapshot(time.UnixMilli(int64(args[1].Float()))))
			if err != nil {
				return ""
			}
			return string(b)
		}),
		// runbook(id) returns a runbook's Markdown, or null if there is none.
		"runbook": js.FuncOf(func(_ js.Value, args []js.Value) any {
			if len(args) < 1 {
				return nil
			}
			if body, ok := demo.RunbookBody(args[0].String()); ok {
				return body
			}
			return nil
		}),
	}))
	select {} // stay loaded: the page calls in for as long as it is open
}
