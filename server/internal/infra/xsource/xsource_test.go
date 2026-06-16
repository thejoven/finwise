package xsource

import "testing"

func TestCompareIDs(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"2064238810582438366", "2064238810582438366", 0},
		{"2064238810582438366", "2064238810582438365", 1},
		{"999", "1000", -1}, // 长度优先
		{"1000", "999", 1},
		{" 123", "123", 0}, // trim
	}
	for _, c := range cases {
		if got := CompareIDs(c.a, c.b); got != c.want {
			t.Errorf("CompareIDs(%q,%q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}
