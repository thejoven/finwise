package signal

import (
	"testing"

	"github.com/google/uuid"
)

// resolveInferenceProject 是分类回写的核心决策, 纯函数无 DB 依赖 —— 直接 table-test 四态.
func TestResolveInferenceProject(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	first := uuid.New()
	pa, pb, pfirst := &a, &b, &first

	cases := []struct {
		name         string
		existing     *uuid.UUID
		autoAssigned bool
		aiChoice     *uuid.UUID
		firstActive  *uuid.UUID
		want         *uuid.UUID
	}{
		{"用户手选 + AI 想改: 保留手选", pa, false, pb, pfirst, pa},
		{"用户手选 + AI 弃权: 保留手选", pa, false, nil, pfirst, pa},
		{"系统临时归类 + AI 合法: 覆盖到 AI", pa, true, pb, pfirst, pb},
		{"系统临时归类 + AI 弃权: 保留临时归属", pa, true, nil, pfirst, pa},
		{"未分类 + AI 合法: 用 AI", nil, false, pb, pfirst, pb},
		{"未分类 + AI 弃权: 落 firstActive 兜底", nil, false, nil, pfirst, pfirst},
		{"未分类 + AI 弃权 + 无分类: 仍未分类", nil, false, nil, nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveInferenceProject(tc.existing, tc.autoAssigned, tc.aiChoice, tc.firstActive)
			if !eqUUIDPtr(got, tc.want) {
				t.Fatalf("got %s, want %s", fmtUUIDPtr(got), fmtUUIDPtr(tc.want))
			}
		})
	}
}

func eqUUIDPtr(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func fmtUUIDPtr(p *uuid.UUID) string {
	if p == nil {
		return "<nil>"
	}
	return p.String()
}
