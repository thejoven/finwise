package twitterdata

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"alphax/server/internal/infra/xsource"
)

// HTTP/鉴权/错误层是骨架里唯一可验证的部分 (解析待样本). 这些测试锁住它.

func TestClientStatusMapping(t *testing.T) {
	cases := []struct {
		status int
		want   error
	}{
		{http.StatusPaymentRequired, xsource.ErrQuotaExceeded},
		{http.StatusTooManyRequests, xsource.ErrRateLimited},
		{http.StatusNotFound, xsource.ErrNotFound},
	}
	for _, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("token"); got != "tok" {
				t.Errorf("token query = %q, want tok", got)
			}
			w.WriteHeader(c.status)
		}))
		cl := NewWithBaseURL("tok", srv.URL)
		_, err := cl.UserTweets(context.Background(), "1", "")
		if !errors.Is(err, c.want) {
			t.Errorf("status %d: err = %v, want %v", c.status, err, c.want)
		}
		srv.Close()
	}
}

func TestClientNotConfigured(t *testing.T) {
	cl := New("")
	if cl.IsConfigured() {
		t.Fatal("empty token should not be configured")
	}
	if _, err := cl.UserTweets(context.Background(), "1", ""); !errors.Is(err, xsource.ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

func TestClientQueryParams(t *testing.T) {
	// 鉴权走 token query (非 header); 账号按 screenName. 返 404 避免触发 parse TODO.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/UserByScreenName" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("screenName"); got != "elonmusk" {
			t.Errorf("screenName = %q", got)
		}
		if got := r.URL.Query().Get("token"); got != "tok" {
			t.Errorf("token = %q", got)
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	cl := NewWithBaseURL("tok", srv.URL)
	if _, err := cl.LookupAccount(context.Background(), "elonmusk"); !errors.Is(err, xsource.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
