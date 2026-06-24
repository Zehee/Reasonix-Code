package memorycompiler

import (
	"math"
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
	maxLongTailCausalAnchors   = 3
)

type CompressionReport struct {
	TraceID          string                  `json:"trace_id,omitempty"`
	Version          string                  `json:"version,omitempty"`
	CausalGraph      CausalGraphCompression  `json:"causal_graph,omitempty"`
	ExecutionTrace   ExecutionCompression    `json:"execution_trace,omitempty"`
	ControlGraph     ControlGraphCompression `json:"control_graph,omitempty"`
	MemoryGraph      MemoryGraphCompression  `json:"memory_graph,omitempty"`
	Alignment        CrossGraphAlignment     `json:"alignment,omitempty"`
	BiasCorrection   CompressionBiasReport   `json:"bias_correction,omitempty"`
	CompressionRatio float64                 `json:"compression_ratio,omitempty"`
	CreatedAt        time.Time               `json:"created_at,omitempty"`
}

type CausalGraphCompression struct {
	TotalEdges      int            `json:"total_edges,omitempty"`
	RetainedEdges   int            `json:"retained_edges,omitempty"`
	DroppedEdges    int            `json:"dropped_edges,omitempty"`
	RelationCounts  map[string]int `json:"relation_counts,omitempty"`
	PrimaryCauses   []string       `json:"primary_causes,omitempty"`
	AnchorEdges     []CausalEdge   `json:"anchor_edges,omitempty"`
	LongTailEdges   []CausalEdge   `json:"long_tail_edges,omitempty"`
	LongTailSignals []string       `json:"long_tail_signals,omitempty"`
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
	TruthLockDecay []string       `json:"truth_lock_decay,omitempty"`
}

type CrossGraphAlignment struct {
	Status            string   `json:"status,omitempty"`
	AbstractionLevel  string   `json:"abstraction_level,omitempty"`
	SharedRelations   []string `json:"shared_relations,omitempty"`
	MissingFromMemory []string `json:"missing_from_memory,omitempty"`
	MissingFromCausal []string `json:"missing_from_causal,omitempty"`
}

type CompressionBiasReport struct {
	AnchorBudget      int      `json:"anchor_budget,omitempty"`
	LongTailRetained  int      `json:"long_tail_retained,omitempty"`
	LongTailRelations []string `json:"long_tail_relations,omitempty"`
	TruthLocksDecayed int      `json:"truth_locks_decayed,omitempty"`
	AlignmentStatus   string   `json:"alignment_status,omitempty"`
}

func applyCausalCompression(st state, tr ExecutionTrace, learning SystemLearning, policy ControlPolicy, now time.Time) (state, ExecutionTrace) {
	report := buildCompressionReport(st, tr, learning, policy, now)
	tr.Compression = &report
	st.CompressionReports = appendCompressionReport(st.CompressionReports, report)
	st.Nodes = retainMemoryNodes(st.Nodes, maxMemoryGraphNodes, now)
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
	memory := compressMemoryGraph(st, now)
	alignment := crossGraphAlignment(causal, memory)
	bias := CompressionBiasReport{
		AnchorBudget:      maxCompressedCausalAnchors,
		LongTailRetained:  len(causal.LongTailEdges),
		LongTailRelations: append([]string(nil), causal.LongTailSignals...),
		TruthLocksDecayed: len(memory.TruthLockDecay),
		AlignmentStatus:   alignment.Status,
	}
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
		Alignment:        alignment,
		BiasCorrection:   bias,
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
	candidates := append([]CausalEdge(nil), edges...)
	sortCausalAnchors(candidates)
	candidates = dedupeCausalEdges(candidates)
	anchors, longTail := selectCausalAnchors(candidates, out.RelationCounts, limit)
	out.LongTailEdges = append([]CausalEdge(nil), longTail...)
	for _, edge := range longTail {
		out.LongTailSignals = append(out.LongTailSignals, edge.Relation)
	}
	out.LongTailSignals = limitStrings(canonicalStrings(out.LongTailSignals), maxCompressionStrings)
	out.AnchorEdges = anchors
	out.RetainedEdges = len(out.AnchorEdges)
	if out.TotalEdges > out.RetainedEdges {
		out.DroppedEdges = out.TotalEdges - out.RetainedEdges
	}
	return out
}

func sortCausalAnchors(edges []CausalEdge) {
	sort.SliceStable(edges, func(i, j int) bool {
		pi := causalEdgePriority(edges[i])
		pj := causalEdgePriority(edges[j])
		if pi != pj {
			return pi < pj
		}
		return causalEdgeKey(edges[i]) < causalEdgeKey(edges[j])
	})
}

func selectCausalAnchors(candidates []CausalEdge, relationCounts map[string]int, limit int) ([]CausalEdge, []CausalEdge) {
	if len(candidates) <= limit {
		return append([]CausalEdge(nil), candidates...), nil
	}
	selected := append([]CausalEdge(nil), candidates[:limit]...)
	longTail := longTailCausalCandidates(candidates, relationCounts, selected, limit)
	if len(longTail) == 0 {
		return selected, nil
	}
	seen := map[string]bool{}
	for _, edge := range selected {
		seen[causalEdgeKey(edge)] = true
	}
	uniqueLongTail := make([]CausalEdge, 0, len(longTail))
	for _, edge := range longTail {
		key := causalEdgeKey(edge)
		if seen[key] {
			continue
		}
		uniqueLongTail = append(uniqueLongTail, edge)
		seen[key] = true
	}
	if len(uniqueLongTail) == 0 {
		return selected, nil
	}
	if len(uniqueLongTail) > len(selected) {
		uniqueLongTail = uniqueLongTail[:len(selected)]
	}
	selected = selected[:limit-len(uniqueLongTail)]
	selected = append(selected, uniqueLongTail...)
	sortCausalAnchors(selected)
	return selected, uniqueLongTail
}

func longTailCausalCandidates(candidates []CausalEdge, relationCounts map[string]int, selected []CausalEdge, limit int) []CausalEdge {
	if limit <= 2 || len(relationCounts) <= 1 {
		return nil
	}
	covered := map[string]bool{}
	for _, edge := range selected {
		covered[edge.Relation] = true
	}
	out := make([]CausalEdge, 0, maxLongTailCausalAnchors)
	longTailBudget := limit / 4
	if longTailBudget < 1 {
		longTailBudget = 1
	}
	if longTailBudget > maxLongTailCausalAnchors {
		longTailBudget = maxLongTailCausalAnchors
	}
	rare := append([]CausalEdge(nil), candidates...)
	sort.SliceStable(rare, func(i, j int) bool {
		ci := relationCounts[rare[i].Relation]
		cj := relationCounts[rare[j].Relation]
		if ci != cj {
			return ci < cj
		}
		pi := causalEdgePriority(rare[i])
		pj := causalEdgePriority(rare[j])
		if pi != pj {
			return pi < pj
		}
		return causalEdgeKey(rare[i]) < causalEdgeKey(rare[j])
	})
	seen := map[string]bool{}
	for _, edge := range rare {
		if covered[edge.Relation] {
			continue
		}
		key := causalEdgeKey(edge)
		if seen[key] {
			continue
		}
		out = append(out, edge)
		seen[key] = true
		if len(out) >= longTailBudget {
			break
		}
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

func compressMemoryGraph(st state, now time.Time) MemoryGraphCompression {
	if now.IsZero() {
		now = time.Now().UTC()
	}
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
		if node.TruthLocked && truthLockedImportance(node, now) < 0.5 {
			out.TruthLockDecay = append(out.TruthLockDecay, node.ID)
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
		pi := memoryNodeCompressionPriority(nodes[i], now)
		pj := memoryNodeCompressionPriority(nodes[j], now)
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
	out.TruthLockDecay = limitStrings(canonicalStrings(out.TruthLockDecay), maxCompressionStrings)
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

func crossGraphAlignment(causal CausalGraphCompression, memory MemoryGraphCompression) CrossGraphAlignment {
	causalRelations := normalizedCausalRelations(causal.RelationCounts)
	memoryRelations := normalizedRelations(memory.RelationCounts)
	shared := intersectRelationKeys(causalRelations, memoryRelations)
	missingFromMemory := relationKeysMissing(causalRelations, memoryRelations)
	missingFromCausal := relationKeysMissing(memoryRelations, causalRelations)
	status := "aligned"
	switch {
	case len(causalRelations) == 0 && len(memoryRelations) == 0:
		status = "empty"
	case len(shared) == 0:
		status = "divergent"
	case len(missingFromMemory) > 0 || len(missingFromCausal) > 0:
		status = "partial"
	}
	level := "shared_lattice"
	switch status {
	case "divergent":
		level = "separate_lattices"
	case "partial":
		level = "mixed_lattice"
	}
	return CrossGraphAlignment{
		Status:            status,
		AbstractionLevel:  level,
		SharedRelations:   limitStrings(canonicalStrings(shared), maxCompressionStrings),
		MissingFromMemory: limitStrings(canonicalStrings(missingFromMemory), maxCompressionStrings),
		MissingFromCausal: limitStrings(canonicalStrings(missingFromCausal), maxCompressionStrings),
	}
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

func retainMemoryNodes(nodes []MemoryNode, limit int, nowArg ...time.Time) []MemoryNode {
	if limit <= 0 || len(nodes) <= limit {
		return nodes
	}
	now := time.Now().UTC()
	if len(nowArg) > 0 && !nowArg[0].IsZero() {
		now = nowArg[0].UTC()
	}
	out := append([]MemoryNode(nil), nodes...)
	sort.SliceStable(out, func(i, j int) bool {
		pi := memoryNodeCompressionPriority(out[i], now)
		pj := memoryNodeCompressionPriority(out[j], now)
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
	out.CausalGraph.LongTailEdges = append([]CausalEdge(nil), in.CausalGraph.LongTailEdges...)
	out.CausalGraph.LongTailSignals = append([]string(nil), in.CausalGraph.LongTailSignals...)
	out.ExecutionTrace.KeyFindings = append([]string(nil), in.ExecutionTrace.KeyFindings...)
	out.ControlGraph.TopSignals = append([]string(nil), in.ControlGraph.TopSignals...)
	out.ControlGraph.EquilibriumActions = append([]string(nil), in.ControlGraph.EquilibriumActions...)
	out.MemoryGraph.QualityCounts = cloneStringIntMap(in.MemoryGraph.QualityCounts)
	out.MemoryGraph.RelationCounts = cloneStringIntMap(in.MemoryGraph.RelationCounts)
	out.MemoryGraph.AnchorNodes = append([]string(nil), in.MemoryGraph.AnchorNodes...)
	out.MemoryGraph.TruthLockDecay = append([]string(nil), in.MemoryGraph.TruthLockDecay...)
	out.Alignment.SharedRelations = append([]string(nil), in.Alignment.SharedRelations...)
	out.Alignment.MissingFromMemory = append([]string(nil), in.Alignment.MissingFromMemory...)
	out.Alignment.MissingFromCausal = append([]string(nil), in.Alignment.MissingFromCausal...)
	out.BiasCorrection.LongTailRelations = append([]string(nil), in.BiasCorrection.LongTailRelations...)
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

func memoryNodeCompressionPriority(node MemoryNode, now time.Time) int {
	if !node.TruthLocked {
		return memoryNodePriority(node)
	}
	importance := truthLockedImportance(node, now)
	switch {
	case importance >= 0.75:
		return 0
	case importance >= 0.5:
		return 2
	default:
		return 4
	}
}

func truthLockedImportance(node MemoryNode, now time.Time) float64 {
	confidence := node.Confidence
	if confidence <= 0 {
		confidence = 1
	}
	if confidence > 1 {
		confidence = 1
	}
	ageDays := 0.0
	if !node.Timestamp.IsZero() && !now.IsZero() && now.After(node.Timestamp) {
		ageDays = now.Sub(node.Timestamp).Hours() / 24
	}
	weight := confidence * math.Exp(-ageDays/45)
	if node.Quality == QualityHighSignal {
		weight += 0.2
	}
	if node.Type == "tool_result" {
		weight += 0.1
	}
	if weight > 1 {
		weight = 1
	}
	return roundScore(weight)
}

func normalizedCausalRelations(counts map[string]int) map[string]bool {
	out := map[string]bool{}
	for relation, count := range counts {
		if count <= 0 {
			continue
		}
		if normalized := graphRelation(relation); normalized != "" {
			out[normalized] = true
		}
	}
	return out
}

func normalizedRelations(counts map[string]int) map[string]bool {
	out := map[string]bool{}
	for relation, count := range counts {
		if count <= 0 {
			continue
		}
		relation = strings.TrimSpace(relation)
		if relation != "" {
			out[relation] = true
		}
	}
	return out
}

func intersectRelationKeys(left, right map[string]bool) []string {
	out := []string{}
	for key := range left {
		if right[key] {
			out = append(out, key)
		}
	}
	return out
}

func relationKeysMissing(source, target map[string]bool) []string {
	out := []string{}
	for key := range source {
		if !target[key] {
			out = append(out, key)
		}
	}
	return out
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
