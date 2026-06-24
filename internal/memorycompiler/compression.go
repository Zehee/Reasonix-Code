package memorycompiler

import (
	"sort"
	"strings"
	"time"
)

const (
	maxCompressedCausalAnchors = 12
	maxCompressionReports      = 30
	maxMemoryGraphNodes        = 300
	maxMemoryGraphEdges        = 600
	maxCompressionStrings      = 10
)

type CompressionReport struct {
	TraceID          string                  `json:"trace_id,omitempty"`
	Version          string                  `json:"version,omitempty"`
	CausalGraph      CausalGraphCompression  `json:"causal_graph,omitempty"`
	ExecutionTrace   ExecutionCompression    `json:"execution_trace,omitempty"`
	ControlGraph     ControlGraphCompression `json:"control_graph,omitempty"`
	MemoryGraph      MemoryGraphCompression  `json:"memory_graph,omitempty"`
	CompressionRatio float64                 `json:"compression_ratio,omitempty"`
	CreatedAt        time.Time               `json:"created_at,omitempty"`
}

type CausalGraphCompression struct {
	TotalEdges     int            `json:"total_edges,omitempty"`
	RetainedEdges  int            `json:"retained_edges,omitempty"`
	DroppedEdges   int            `json:"dropped_edges,omitempty"`
	RelationCounts map[string]int `json:"relation_counts,omitempty"`
	PrimaryCauses  []string       `json:"primary_causes,omitempty"`
	AnchorEdges    []CausalEdge   `json:"anchor_edges,omitempty"`
}

type ExecutionCompression struct {
	Outcome     string   `json:"outcome,omitempty"`
	Strategy    string   `json:"strategy,omitempty"`
	StepCount   int      `json:"step_count,omitempty"`
	ToolCalls   int      `json:"tool_calls,omitempty"`
	ToolErrors  int      `json:"tool_errors,omitempty"`
	KeyFindings []string `json:"key_findings,omitempty"`
	CostBand    string   `json:"cost_band,omitempty"`
	LatencyBand string   `json:"latency_band,omitempty"`
}

type ControlGraphCompression struct {
	Mode               string   `json:"mode,omitempty"`
	Controller         string   `json:"controller,omitempty"`
	ReportsFolded      int      `json:"reports_folded,omitempty"`
	StabilityBand      string   `json:"stability_band,omitempty"`
	OscillationBand    string   `json:"oscillation_band,omitempty"`
	EquilibriumState   string   `json:"equilibrium_state,omitempty"`
	TopSignals         []string `json:"top_signals,omitempty"`
	EquilibriumActions []string `json:"equilibrium_actions,omitempty"`
}

type MemoryGraphCompression struct {
	NodesFolded    int            `json:"nodes_folded,omitempty"`
	EdgesFolded    int            `json:"edges_folded,omitempty"`
	QualityCounts  map[string]int `json:"quality_counts,omitempty"`
	RelationCounts map[string]int `json:"relation_counts,omitempty"`
	AnchorNodes    []string       `json:"anchor_nodes,omitempty"`
	ConflictCount  int            `json:"conflict_count,omitempty"`
	NoiseCount     int            `json:"noise_count,omitempty"`
}

func applyCausalCompression(st state, tr ExecutionTrace, learning SystemLearning, policy ControlPolicy, now time.Time) (state, ExecutionTrace) {
	report := buildCompressionReport(st, tr, learning, policy, now)
	tr.Compression = &report
	st.CompressionReports = appendCompressionReport(st.CompressionReports, report)
	st.Nodes = retainMemoryNodes(st.Nodes, maxMemoryGraphNodes)
	st.Edges = retainMemoryEdges(st.Edges, maxMemoryGraphEdges)
	return st, tr
}

func buildCompressionReport(st state, tr ExecutionTrace, learning SystemLearning, policy ControlPolicy, now time.Time) CompressionReport {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	causal := compressCausalEdges(tr.CausalEdges, tr.ProductionHardening, maxCompressedCausalAnchors)
	execution := compressExecutionTrace(tr, learning)
	control := compressControlGraph(st, policy)
	memory := compressMemoryGraph(st)
	total := causal.TotalEdges + len(tr.ToolResults) + len(st.Nodes) + len(st.Edges) + len(st.ControlReports)
	retained := causal.RetainedEdges + len(memory.AnchorNodes) + len(control.TopSignals) + len(execution.KeyFindings)
	ratio := 1.0
	if total > 0 {
		ratio = roundScore(float64(retained) / float64(total))
	}
	return CompressionReport{
		TraceID:          tr.ID,
		Version:          version,
		CausalGraph:      causal,
		ExecutionTrace:   execution,
		ControlGraph:     control,
		MemoryGraph:      memory,
		CompressionRatio: ratio,
		CreatedAt:        now.UTC(),
	}
}

func compressCausalEdges(edges []CausalEdge, hardening *ProductionHardeningTrace, limit int) CausalGraphCompression {
	if limit <= 0 {
		limit = maxCompressedCausalAnchors
	}
	out := CausalGraphCompression{
		TotalEdges:     len(edges),
		RelationCounts: map[string]int{},
	}
	for _, edge := range edges {
		relation := strings.TrimSpace(edge.Relation)
		if relation == "" {
			relation = "unknown"
		}
		out.RelationCounts[relation]++
	}
	if hardening != nil {
		if cause := strings.TrimSpace(hardening.CanaryDiff.Attribution.PrimaryCause); cause != "" && cause != "none" {
			out.PrimaryCauses = append(out.PrimaryCauses, cause)
		}
		for _, factor := range hardening.CanaryDiff.Attribution.Factors {
			if factor.Cause != "" {
				out.PrimaryCauses = append(out.PrimaryCauses, factor.Layer+":"+factor.Cause)
			}
		}
	}
	out.PrimaryCauses = limitStrings(canonicalStrings(out.PrimaryCauses), maxCompressionStrings)
	anchors := append([]CausalEdge(nil), edges...)
	sort.SliceStable(anchors, func(i, j int) bool {
		pi := causalEdgePriority(anchors[i])
		pj := causalEdgePriority(anchors[j])
		if pi != pj {
			return pi < pj
		}
		return causalEdgeKey(anchors[i]) < causalEdgeKey(anchors[j])
	})
	anchors = dedupeCausalEdges(anchors)
	if len(anchors) > limit {
		out.AnchorEdges = anchors[:limit]
	} else {
		out.AnchorEdges = anchors
	}
	out.RetainedEdges = len(out.AnchorEdges)
	if out.TotalEdges > out.RetainedEdges {
		out.DroppedEdges = out.TotalEdges - out.RetainedEdges
	}
	return out
}

func compressExecutionTrace(tr ExecutionTrace, learning SystemLearning) ExecutionCompression {
	findings := []string{}
	findings = append(findings, tr.FailureReason)
	findings = append(findings, tr.SemanticDriftHard...)
	findings = append(findings, learning.CausalFindings...)
	findings = append(findings, learning.CompilerImprovements...)
	return ExecutionCompression{
		Outcome:     tr.Outcome,
		Strategy:    firstNonEmpty(tr.StrategyUsed, classifyStrategy(tr.Goal)),
		StepCount:   len(tr.Steps),
		ToolCalls:   tr.Cost.ToolCalls,
		ToolErrors:  tr.Cost.ToolErrors,
		KeyFindings: limitStrings(canonicalStrings(findings), maxCompressionStrings),
		CostBand:    tokenBand(tr.Cost.EstimatedInputTokens + tr.Cost.EstimatedCompiledTokens),
		LatencyBand: latencyBand(tr.Cost.LatencyMs),
	}
}

func compressControlGraph(st state, policy ControlPolicy) ControlGraphCompression {
	signals := []string{}
	signals = append(signals, policy.Reasons...)
	signals = append(signals, policy.SemanticShift...)
	return ControlGraphCompression{
		Mode:               policy.Mode,
		Controller:         policy.Controller,
		ReportsFolded:      len(st.ControlReports),
		StabilityBand:      scoreBand(policy.SystemStabilityScore),
		OscillationBand:    scoreBand(policy.OscillationIndex),
		EquilibriumState:   policy.EquilibriumState,
		TopSignals:         limitStrings(canonicalStrings(signals), maxCompressionStrings),
		EquilibriumActions: limitStrings(canonicalStrings(policy.EquilibriumActions), maxCompressionStrings),
	}
}

func compressMemoryGraph(st state) MemoryGraphCompression {
	out := MemoryGraphCompression{
		NodesFolded:    len(st.Nodes),
		EdgesFolded:    len(st.Edges),
		QualityCounts:  map[string]int{},
		RelationCounts: map[string]int{},
	}
	for _, node := range st.Nodes {
		quality := string(node.Quality)
		if quality == "" {
			quality = "UNKNOWN"
		}
		out.QualityCounts[quality]++
		if node.Quality == QualityNoise || node.Quality == QualityCorrupted {
			out.NoiseCount++
		}
	}
	for _, edge := range st.Edges {
		relation := strings.TrimSpace(edge.Relation)
		if relation == "" {
			relation = "unknown"
		}
		out.RelationCounts[relation]++
		if relation == "contradicts" {
			out.ConflictCount++
		}
	}
	nodes := append([]MemoryNode(nil), st.Nodes...)
	sort.SliceStable(nodes, func(i, j int) bool {
		pi := memoryNodePriority(nodes[i])
		pj := memoryNodePriority(nodes[j])
		if pi != pj {
			return pi < pj
		}
		if nodes[i].Confidence != nodes[j].Confidence {
			return nodes[i].Confidence > nodes[j].Confidence
		}
		if !nodes[i].Timestamp.Equal(nodes[j].Timestamp) {
			return nodes[i].Timestamp.After(nodes[j].Timestamp)
		}
		return nodes[i].ID < nodes[j].ID
	})
	anchors := []string{}
	for _, node := range nodes {
		if strings.TrimSpace(node.ID) == "" {
			continue
		}
		anchors = append(anchors, node.ID)
		if len(anchors) >= maxCompressionStrings {
			break
		}
	}
	out.AnchorNodes = anchors
	return out
}

func appendCompressionReport(existing []CompressionReport, report CompressionReport) []CompressionReport {
	if strings.TrimSpace(report.TraceID) != "" {
		for _, existingReport := range existing {
			if existingReport.TraceID == report.TraceID {
				return existing
			}
		}
	}
	existing = append(existing, report)
	if len(existing) > maxCompressionReports {
		existing = existing[len(existing)-maxCompressionReports:]
	}
	return existing
}

func retainMemoryNodes(nodes []MemoryNode, limit int) []MemoryNode {
	if limit <= 0 || len(nodes) <= limit {
		return nodes
	}
	out := append([]MemoryNode(nil), nodes...)
	sort.SliceStable(out, func(i, j int) bool {
		pi := memoryNodePriority(out[i])
		pj := memoryNodePriority(out[j])
		if pi != pj {
			return pi < pj
		}
		if out[i].Confidence != out[j].Confidence {
			return out[i].Confidence > out[j].Confidence
		}
		if !out[i].Timestamp.Equal(out[j].Timestamp) {
			return out[i].Timestamp.After(out[j].Timestamp)
		}
		return out[i].ID < out[j].ID
	})
	out = out[:limit]
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Timestamp.Equal(out[j].Timestamp) {
			return out[i].ID < out[j].ID
		}
		return out[i].Timestamp.Before(out[j].Timestamp)
	})
	return out
}

func retainMemoryEdges(edges []MemoryEdge, limit int) []MemoryEdge {
	if limit <= 0 || len(edges) <= limit {
		return edges
	}
	out := append([]MemoryEdge(nil), edges...)
	sort.SliceStable(out, func(i, j int) bool {
		pi := memoryEdgePriority(out[i])
		pj := memoryEdgePriority(out[j])
		if pi != pj {
			return pi < pj
		}
		return memoryEdgeKey(out[i]) < memoryEdgeKey(out[j])
	})
	return out[:limit]
}

func cloneCompressionReport(in *CompressionReport) *CompressionReport {
	if in == nil {
		return nil
	}
	out := *in
	out.CausalGraph.RelationCounts = cloneStringIntMap(in.CausalGraph.RelationCounts)
	out.CausalGraph.PrimaryCauses = append([]string(nil), in.CausalGraph.PrimaryCauses...)
	out.CausalGraph.AnchorEdges = append([]CausalEdge(nil), in.CausalGraph.AnchorEdges...)
	out.ExecutionTrace.KeyFindings = append([]string(nil), in.ExecutionTrace.KeyFindings...)
	out.ControlGraph.TopSignals = append([]string(nil), in.ControlGraph.TopSignals...)
	out.ControlGraph.EquilibriumActions = append([]string(nil), in.ControlGraph.EquilibriumActions...)
	out.MemoryGraph.QualityCounts = cloneStringIntMap(in.MemoryGraph.QualityCounts)
	out.MemoryGraph.RelationCounts = cloneStringIntMap(in.MemoryGraph.RelationCounts)
	out.MemoryGraph.AnchorNodes = append([]string(nil), in.MemoryGraph.AnchorNodes...)
	return &out
}

func cloneStringIntMap(in map[string]int) map[string]int {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]int, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func dedupeCausalEdges(edges []CausalEdge) []CausalEdge {
	seen := map[string]bool{}
	out := edges[:0]
	for _, edge := range edges {
		key := causalEdgeKey(edge)
		if key == "\x00\x00" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, edge)
	}
	return out
}

func causalEdgePriority(edge CausalEdge) int {
	switch {
	case edge.Relation == "explains_divergence":
		return 0
	case strings.HasPrefix(edge.Relation, "selected_strategy:"):
		return 1
	case edge.Relation == "weakened_outcome":
		return 2
	case edge.Relation == "supported_outcome":
		return 3
	case edge.Relation == "constrained":
		return 4
	case edge.Relation == "influenced":
		return 5
	default:
		return 9
	}
}

func causalEdgeKey(edge CausalEdge) string {
	return strings.TrimSpace(edge.Relation) + "\x00" + strings.TrimSpace(edge.From) + "\x00" + strings.TrimSpace(edge.To)
}

func memoryNodePriority(node MemoryNode) int {
	switch {
	case node.TruthLocked:
		return 0
	case node.Quality == QualityHighSignal:
		return 1
	case node.Type == "decision":
		return 2
	case node.Quality == QualityMediumSignal:
		return 3
	case node.Quality == QualityNoise:
		return 8
	case node.Quality == QualityCorrupted:
		return 9
	default:
		return 5
	}
}

func memoryEdgePriority(edge MemoryEdge) int {
	switch edge.Relation {
	case "supports":
		return 0
	case "causes":
		return 1
	case "depends_on":
		return 2
	case "derived_from":
		return 3
	case "contradicts":
		return 4
	default:
		return 9
	}
}

func memoryEdgeKey(edge MemoryEdge) string {
	return strings.TrimSpace(edge.Relation) + "\x00" + strings.TrimSpace(edge.From) + "\x00" + strings.TrimSpace(edge.To)
}

func scoreBand(score float64) string {
	switch {
	case score >= 0.8:
		return "high"
	case score >= 0.4:
		return "medium"
	case score > 0:
		return "low"
	default:
		return "none"
	}
}

func tokenBand(tokens int) string {
	switch {
	case tokens >= 16000:
		return "very_high"
	case tokens >= 8000:
		return "high"
	case tokens >= 2000:
		return "medium"
	case tokens > 0:
		return "low"
	default:
		return "none"
	}
}

func latencyBand(ms int64) string {
	switch {
	case ms >= 300000:
		return "very_high"
	case ms >= 60000:
		return "high"
	case ms >= 10000:
		return "medium"
	case ms > 0:
		return "low"
	default:
		return "none"
	}
}
