package memorycompiler

import (
	"fmt"
	"testing"
	"time"

	runtimecanary "reasonix/internal/runtime/canary"
)

func TestCompressCausalEdgesRetainsAnchorsAndCounts(t *testing.T) {
	edges := []CausalEdge{}
	for i := 0; i < 40; i++ {
		relation := "influenced"
		if i%5 == 0 {
			relation = "explains_divergence"
		}
		edges = append(edges, CausalEdge{
			From:     fmt.Sprintf("from-%02d", i),
			To:       fmt.Sprintf("to-%02d", i),
			Relation: relation,
		})
	}
	hardening := &ProductionHardeningTrace{
		CanaryDiff: runtimecanary.BehaviorDiff{
			Attribution: runtimecanary.CausalAttribution{
				PrimaryCause: "decision_changed",
				Factors: []runtimecanary.CausalFactor{{
					Layer:    "control",
					Cause:    "decision_changed",
					Severity: "high",
				}},
			},
		},
	}
	compressed := compressCausalEdges(edges, hardening, 12)
	if compressed.TotalEdges != 40 || compressed.RetainedEdges != 12 || compressed.DroppedEdges != 28 {
		t.Fatalf("unexpected edge counts: %+v", compressed)
	}
	if compressed.RelationCounts["explains_divergence"] != 8 || compressed.RelationCounts["influenced"] != 32 {
		t.Fatalf("relation counts lost causality: %+v", compressed.RelationCounts)
	}
	if len(compressed.PrimaryCauses) == 0 || compressed.PrimaryCauses[0] != "control:decision_changed" {
		t.Fatalf("missing primary cause attribution: %+v", compressed.PrimaryCauses)
	}
	for _, edge := range compressed.AnchorEdges[:8] {
		if edge.Relation != "explains_divergence" {
			t.Fatalf("high-priority divergence edge was not retained first: %+v", compressed.AnchorEdges)
		}
	}
}

func TestLearningTraceUsesCompressedCausalEdges(t *testing.T) {
	edges := []CausalEdge{}
	for i := 0; i < 50; i++ {
		edges = append(edges, CausalEdge{
			From:     fmt.Sprintf("tool:%d", i),
			To:       "outcome:trace-compress",
			Relation: "supported_outcome",
		})
	}
	tr := ExecutionTrace{
		ID:          "trace-compress",
		IRVersion:   version,
		Goal:        "compress traces",
		Outcome:     "success",
		CausalEdges: edges,
	}
	learning := SystemLearning{TraceID: tr.ID, CausalFindings: []string{"memory m1 supported successful outcome"}}
	lt, ok := learningTraceFor(tr, learning)
	if !ok {
		t.Fatal("expected learning trace")
	}
	if len(lt.CausalEdges) != maxCompressedCausalAnchors {
		t.Fatalf("learning trace kept %d causal edges, want %d", len(lt.CausalEdges), maxCompressedCausalAnchors)
	}
}

func TestCausalCompressionSummarizesStateAndRetainsImportantMemory(t *testing.T) {
	now := time.Now().UTC()
	nodes := []MemoryNode{{
		ID:          "truth-old",
		Type:        "tool_result",
		Content:     "stable result",
		Timestamp:   now.Add(-24 * time.Hour),
		Confidence:  0.2,
		Quality:     QualityNoise,
		TruthLocked: true,
	}}
	for i := 0; i < maxMemoryGraphNodes+20; i++ {
		nodes = append(nodes, MemoryNode{
			ID:         fmt.Sprintf("noise-%03d", i),
			Type:       "state",
			Content:    "low signal",
			Timestamp:  now.Add(time.Duration(i) * time.Second),
			Confidence: 0.1,
			Quality:    QualityNoise,
		})
	}
	st := state{
		Nodes:          nodes,
		Edges:          []MemoryEdge{{From: "truth-old", To: "trace-1", Relation: "supports"}},
		ControlReports: []ControlReport{{TraceID: "previous", Mode: "balanced"}},
		NoisyRefs:      map[string]int{},
	}
	tr := ExecutionTrace{
		ID:           "trace-compression-state",
		Goal:         "compress runtime state",
		Outcome:      "success",
		StrategyUsed: []string{"general"},
		Cost:         CostMetrics{ToolCalls: 1, EstimatedInputTokens: 10},
		StartedAt:    now,
		CompletedAt:  now.Add(time.Second),
	}
	next, tr := applyCausalCompression(st, tr, SystemLearning{TraceID: tr.ID}, defaultControlPolicy(), now)
	if tr.Compression == nil {
		t.Fatal("missing trace compression report")
	}
	if len(next.CompressionReports) != 1 {
		t.Fatalf("compression reports = %d, want 1", len(next.CompressionReports))
	}
	if len(next.Nodes) != maxMemoryGraphNodes {
		t.Fatalf("retained nodes = %d, want %d", len(next.Nodes), maxMemoryGraphNodes)
	}
	foundTruth := false
	for _, node := range next.Nodes {
		if node.ID == "truth-old" {
			foundTruth = true
			break
		}
	}
	if !foundTruth {
		t.Fatalf("truth-locked node was lost during memory folding")
	}
	if tr.Compression.MemoryGraph.NodesFolded != len(nodes) {
		t.Fatalf("compression report nodes folded = %d, want %d", tr.Compression.MemoryGraph.NodesFolded, len(nodes))
	}
}
