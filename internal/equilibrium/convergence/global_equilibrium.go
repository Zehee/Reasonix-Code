package convergence

import (
	"math"

	controlgraph "reasonix/internal/controlplane/control_graph"
	anticentralization "reasonix/internal/equilibrium/anti_centralization"
	equilibriumpolicy "reasonix/internal/equilibrium/equilibrium_policy"
	globalstate "reasonix/internal/equilibrium/global_state"
	stabilitywindow "reasonix/internal/equilibrium/stability_window"
)

func FilterDecision(decision controlgraph.ControlDecision, history []globalstate.DecisionSample) (controlgraph.ControlDecision, globalstate.EquilibriumTrace) {
	current := stabilitywindow.SampleFromDecision(decision)
	window := stabilitywindow.Append(history, current, stabilitywindow.DefaultSize)
	st := stabilitywindow.Analyze(window)
	report := DetectOscillation(window)
	policy := equilibriumpolicy.ForState(st, report)
	adjustments := append([]string(nil), policy.Actions...)

	decision = applyPolicy(decision, st, report, policy, &adjustments)
	var guardAdjustments []string
	decision, guardAdjustments = anticentralization.Apply(decision, policy, st)
	adjustments = append(adjustments, guardAdjustments...)

	decision.EquilibriumState = stateLabel(st, report)
	decision.EquilibriumActions = limitStrings(dedupeStrings(adjustments), 6)
	decision.ControlGraphEntropy = round(st.ControlGraphEntropy)
	decision.SystemStabilityScore = round(st.SystemStabilityScore)
	decision.ConvergenceVelocity = round(st.ConvergenceVelocity)
	decision.OscillationIndex = round(st.OscillationIndex)
	decision.ExplorationRatePercent = controlgraph.ClampRate(decision.ExplorationRatePercent)
	decision.Gain = round(decision.Gain)
	decision.Confidence = round(controlgraph.Clamp01(decision.Confidence))
	decision.Reasons = limitStrings(dedupeStrings(append(decision.Reasons, decision.EquilibriumActions...)), 8)

	trace := globalstate.EquilibriumTrace{
		State:             st,
		Policy:            policy,
		OscillationReport: report,
		Adjustments:       append([]string(nil), decision.EquilibriumActions...),
	}
	return decision, trace
}

func applyPolicy(decision controlgraph.ControlDecision, st globalstate.GlobalEquilibriumState, report globalstate.OscillationReport, policy globalstate.EquilibriumPolicy, adjustments *[]string) controlgraph.ControlDecision {
	if report.Severity == "high" || st.OscillationIndex >= equilibriumpolicy.HighOscillationThreshold {
		decision.Action = controlgraph.ActionDampen
		decision.ExplorationRatePercent = controlgraph.MinExplorationRatePercent
		decision.Gain = minPositive(decision.Gain, policy.DampingFactor)
		*adjustments = append(*adjustments, "global oscillation damped")
		return decision
	}
	if st.WindowSize >= 3 && decision.ConsensusScore < policy.ConsensusThreshold && (report.Severity == "medium" || st.OscillationIndex >= 0.45) {
		decision.Action = controlgraph.ActionDampen
		decision.ExplorationRatePercent = controlgraph.MinExplorationRatePercent
		decision.Gain = minPositive(decision.Gain, policy.DampingFactor)
		*adjustments = append(*adjustments, "low consensus gated by equilibrium")
		return decision
	}
	if st.WindowSize >= 4 && st.ConvergenceVelocity < equilibriumpolicy.LowConvergenceVelocity && st.SystemStabilityScore >= equilibriumpolicy.StableConvergenceThreshold && st.OscillationIndex < 0.25 {
		if decision.Action != controlgraph.ActionSafeMode && decision.Action != controlgraph.ActionStabilize {
			decision.Action = controlgraph.ActionExplore
			decision.ExplorationRatePercent = controlgraph.MaxExplorationRatePercent
			decision.Gain = math.Max(decision.Gain, policy.DampingFactor)
			*adjustments = append(*adjustments, "converged window reopened bounded exploration")
		}
	}
	return decision
}

func stateLabel(st globalstate.GlobalEquilibriumState, report globalstate.OscillationReport) string {
	switch {
	case report.Severity == "high" || st.OscillationIndex >= equilibriumpolicy.HighOscillationThreshold:
		return "damping"
	case st.ControlGraphEntropy < equilibriumpolicy.EntropyFloor:
		return "entropy_guard"
	case st.WindowSize >= 4 && st.ConvergenceVelocity < equilibriumpolicy.LowConvergenceVelocity && st.SystemStabilityScore >= equilibriumpolicy.StableConvergenceThreshold:
		return "converged"
	case report.Severity == "medium" || st.OscillationIndex >= 0.45:
		return "watch"
	default:
		return "stable"
	}
}

func minPositive(a, b float64) float64 {
	if a <= 0 {
		return b
	}
	if b <= 0 {
		return a
	}
	if a < b {
		return a
	}
	return b
}

func round(v float64) float64 {
	if v > -0.00005 && v < 0.00005 {
		return 0
	}
	return math.Round(v*10000) / 10000
}

func dedupeStrings(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func limitStrings(in []string, n int) []string {
	if len(in) > n {
		return append([]string(nil), in[:n]...)
	}
	if in == nil {
		return []string{}
	}
	return append([]string(nil), in...)
}
