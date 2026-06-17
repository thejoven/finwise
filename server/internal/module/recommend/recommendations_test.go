package recommend

import "testing"

func TestIsValidContext(t *testing.T) {
	for _, c := range []string{ContextFeed, ContextCommitment, ContextArchive, ContextDigest} {
		if !isValidContext(c) {
			t.Errorf("%q 应为合法 context", c)
		}
	}
	for _, c := range []string{"", "comment", "Feed", "x"} {
		if isValidContext(c) {
			t.Errorf("%q 不应为合法 context", c)
		}
	}
}

func TestIsValidStatus(t *testing.T) {
	for _, s := range []string{StatusPending, StatusSurfaced, StatusDismissed, StatusPromoted, StatusExpired} {
		if !isValidStatus(s) {
			t.Errorf("%q 应为合法 status", s)
		}
	}
	// "seen" 是动作名(映射到 surfaced), 不是合法 status 取值.
	for _, s := range []string{"", "done", "Pending", "seen"} {
		if isValidStatus(s) {
			t.Errorf("%q 不应为合法 status", s)
		}
	}
}
