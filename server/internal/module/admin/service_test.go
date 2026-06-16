package admin

import "testing"

func TestPassRate(t *testing.T) {
	cases := []struct {
		passed, total int
		want          float64
	}{
		{0, 0, 0},     // 除零保护
		{0, 10, 0},    // 全否
		{1, 10, 0.1},  // 普通
		{9, 9, 1},     // 全过
		{1, 3, 0.333}, // 3 位小数舍入
		{2, 3, 0.667},
	}
	for _, c := range cases {
		if got := passRate(c.passed, c.total); got != c.want {
			t.Errorf("passRate(%d, %d) = %v, want %v", c.passed, c.total, got, c.want)
		}
	}
}
