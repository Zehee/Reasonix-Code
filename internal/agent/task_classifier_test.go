package agent

import (
	"context"
	"testing"

	"reasonix/internal/provider"
)

// TestHeuristicClassifier_IsTask 测试启发式分类器
func TestHeuristicClassifier_IsTask(t *testing.T) {
	classifier := newHeuristicClassifier()
	ctx := context.Background()

	tests := []struct {
		name  string
		input string
		want  bool
	}{
		// 问候语 - 聊天
		{"hello", "hello", false},
		{"hi", "hi", false},
		{"你好", "你好", false},
		{"thanks", "thanks", false},
		{"谢谢", "谢谢", false},
		{"ok", "ok", false},
		{"好的", "好的", false},

		// 明确的任务
		{"fix bug", "fix the bug", true},
		{"create component", "create a component", true},
		{"修复问题", "修复这个问题", true},
		{"run tests", "run tests", true},

		// False positive 场景（当前关键词方法会失败）
		// TODO: 这些是已知的 false positives，LLM 分类器应该修复
		{"thanks for fixing", "thanks for fixing that!", true}, // 包含 "fixing" - heuristic 会误判为 task
		{"check later", "I'll check later", true},              // 包含 "check" - heuristic 会误判为 task
		{"test was helpful", "that test was helpful", true},    // 包含 "test" - heuristic 会误判为 task

		// False negative 场景（当前关键词方法会失败）
		// TODO: 这些是已知的 false negatives，LLM 分类器应该修复
		{"auth not working", "the auth isn't working", false},  // 无动作词 - heuristic 会误判为 chat
		{"help with login", "can you help with login?", false}, // 无动作词 - heuristic 会误判为 chat
		{"问题严重", "这个问题很严重", false},                             // 无动作词 - heuristic 会误判为 chat

		// 文件引用
		{"file reference", "what about @auth.go", true},
		{"python file", "check main.py", true},

		// 边界情况
		{"empty", "", false},
		{"spaces", "   ", false},
		{"question mark", "?", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := classifier.IsTask(ctx, tt.input)
			if err != nil {
				t.Fatalf("IsTask() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("IsTask(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

// fakeClassifierProvider 用于测试 LLM 分类器的 mock provider
type fakeClassifierProvider struct {
	reply     string
	streamErr error
}

func (f *fakeClassifierProvider) Name() string { return "fake" }

func (f *fakeClassifierProvider) Stream(_ context.Context, req provider.Request) (<-chan provider.Chunk, error) {
	ch := make(chan provider.Chunk, 2)
	if f.streamErr != nil {
		ch <- provider.Chunk{Type: provider.ChunkError, Err: f.streamErr}
		close(ch)
		return ch, nil
	}
	ch <- provider.Chunk{Type: provider.ChunkText, Text: f.reply}
	ch <- provider.Chunk{Type: provider.ChunkDone}
	close(ch)
	return ch, nil
}

// TestLLMClassifier_IsTask 测试 LLM 分类器
func TestLLMClassifier_IsTask(t *testing.T) {
	ctx := context.Background()
	heuristic := newHeuristicClassifier()

	tests := []struct {
		name      string
		input     string
		llmReply  string
		want      bool
		streamErr error
	}{
		{"llm says task", "fix the bug", "task", true, nil},
		{"llm says chat", "hello", "chat", false, nil},
		{"llm error fallback", "fix bug", "", true, context.DeadlineExceeded},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			prov := &fakeClassifierProvider{reply: tt.llmReply, streamErr: tt.streamErr}
			classifier := newLLMClassifier(prov, heuristic)

			got, err := classifier.IsTask(ctx, tt.input)
			if err != nil {
				t.Fatalf("IsTask() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("IsTask(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

// TestLLMClassifier_Cache 测试 LLM 分类器缓存
func TestLLMClassifier_Cache(t *testing.T) {
	ctx := context.Background()
	prov := &fakeClassifierProvider{reply: "task"}
	heuristic := newHeuristicClassifier()
	classifier := newLLMClassifier(prov, heuristic)

	// 第一次调用应该调用 LLM
	got1, err1 := classifier.IsTask(ctx, "fix bug")
	if err1 != nil {
		t.Fatalf("IsTask() error = %v", err1)
	}
	if !got1 {
		t.Error("expected task classification")
	}

	// 第二次调用相同输入应该从缓存返回
	got2, err2 := classifier.IsTask(ctx, "fix bug")
	if err2 != nil {
		t.Fatalf("IsTask() error = %v", err2)
	}
	if !got2 {
		t.Error("expected cached task classification")
	}
}
