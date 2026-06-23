// Package eventwire defines the shared frontend JSON contract for event.Event.
package eventwire

import "reasonix/internal/event"

// Event is the JSON-friendly form shared by event frontends.
type Event struct {
	Kind         string `json:"kind"`
	RetryAttempt int    `json:"retryAttempt,omitempty"`
	RetryMax     int    `json:"retryMax,omitempty"`
}

// ToWire converts a typed runtime event into the shared frontend JSON contract.
func ToWire(e event.Event) Event {
	w := Event{Kind: kindNames[e.Kind]}
	if e.Kind == event.Retrying {
		w.RetryAttempt = e.RetryAttempt
		w.RetryMax = e.RetryMax
	}
	return w
}

var kindNames = map[event.Kind]string{
	event.TurnStarted:       "turn_started",
	event.Reasoning:         "reasoning",
	event.Text:              "text",
	event.Message:           "message",
	event.ToolDispatch:      "tool_dispatch",
	event.ToolResult:        "tool_result",
	event.Usage:             "usage",
	event.Notice:            "notice",
	event.Phase:             "phase",
	event.ApprovalRequest:   "approval_request",
	event.AskRequest:        "ask_request",
	event.TurnDone:          "turn_done",
	event.CompactionStarted: "compaction_started",
	event.CompactionDone:    "compaction_done",
	event.ToolProgress:      "tool_progress",
	event.MCPSurfaceReady:   "mcp_surface_ready",
	event.Retrying:          "retrying",
	event.Steer:             "steer",
}
