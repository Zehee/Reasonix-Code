package planmode

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecideAllowsReadOnlyResearchAndBlocksKnownWriters(t *testing.T) {
	p := Policy{}

	allowed := p.Decide(Call{Name: "read_file", ReadOnly: true})
	if allowed.Blocked {
		t.Fatalf("read-only research tool blocked: %s", allowed.Message)
	}

	blocked := p.Decide(Call{Name: "write_file", ReadOnly: false})
	if !blocked.Blocked {
		t.Fatal("write_file should be blocked in plan mode")
	}
	if !strings.Contains(blocked.Message, "not available in plan mode") {
		t.Fatalf("blocked message = %q, want plan-mode availability explanation", blocked.Message)
	}
}

func TestDecideDoesNotLetOverridesReopenKnownBlockedTools(t *testing.T) {
	p := Policy{AllowedTools: []string{"write_file"}}

	decision := p.Decide(Call{Name: "write_file", ReadOnly: false})
	if !decision.Blocked {
		t.Fatal("plan_mode_allowed_tools must not allow known blocked writer tools")
	}
	if got := p.IgnoredAllowedTools(); len(got) != 1 || got[0] != "write_file" {
		t.Fatalf("IgnoredAllowedTools() = %v, want [write_file]", got)
	}
}

func TestDecideStillValidatesBashArgumentsWhenOverridden(t *testing.T) {
	p := Policy{AllowedTools: []string{"bash"}}
	args, err := json.Marshal(map[string]any{"command": "rm -rf /"})
	if err != nil {
		t.Fatal(err)
	}

	decision := p.Decide(Call{Name: "bash", ReadOnly: false, Args: args})
	if !decision.Blocked {
		t.Fatal("bash override must not bypass plan-mode bash safety checks")
	}
}
