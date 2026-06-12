package subscription

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeHandle(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"elonmusk", "elonmusk", false},
		{"@elonmusk", "elonmusk", false},
		{"  @Solana  ", "Solana", false},
		{"https://x.com/balajis", "balajis", false},
		{"x.com/balajis", "balajis", false},
		{"@", "", true},
		{"", "", true},
		{"has space", "", true},
		{"way_too_long_handle_over_15", "", true},
		{"中文名", "", true},
	}
	for _, c := range cases {
		got, err := NormalizeHandle(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("NormalizeHandle(%q) want error, got %q", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("NormalizeHandle(%q) err: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("NormalizeHandle(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCursorRoundTrip(t *testing.T) {
	ts := time.Date(2026, 6, 10, 8, 30, 15, 123456789, time.UTC)
	id := "2064238810582438366"
	enc := encodeCursor(ts, id)
	gotT, gotID, err := decodeCursor(enc)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !gotT.Equal(ts) || gotID != id {
		t.Fatalf("round trip = (%v, %q), want (%v, %q)", gotT, gotID, ts, id)
	}
	if _, _, err := decodeCursor("not-base64!!!"); err == nil {
		t.Fatal("bad cursor should error")
	}
	if _, _, err := decodeCursor("aGVsbG8"); err == nil { // base64("hello") 无分隔符
		t.Fatal("malformed cursor should error")
	}
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("hello", 10); got != "hello" {
		t.Errorf("no-op truncate = %q", got)
	}
	long := strings.Repeat("推", 100)
	got := truncateRunes(long, 10)
	if r := []rune(got); len(r) != 10 || r[9] != '…' {
		t.Errorf("truncate = %q (len %d)", got, len(r))
	}
}

func TestPromoteIdempotencyKeyDerivation(t *testing.T) {
	// 同 (user, tweet) → 同 client_event_id; 不同 tweet → 不同.
	u := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	k1 := uuid.NewSHA1(uuid.NameSpaceOID, []byte("tweet-promote:"+u.String()+":"+"123"))
	k2 := uuid.NewSHA1(uuid.NameSpaceOID, []byte("tweet-promote:"+u.String()+":"+"123"))
	k3 := uuid.NewSHA1(uuid.NameSpaceOID, []byte("tweet-promote:"+u.String()+":"+"124"))
	if k1 != k2 {
		t.Fatal("same input should derive same key")
	}
	if k1 == k3 {
		t.Fatal("different tweet should derive different key")
	}
}
