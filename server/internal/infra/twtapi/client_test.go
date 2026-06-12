package twtapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientStatusMapping(t *testing.T) {
	cases := []struct {
		status int
		want   error
	}{
		{http.StatusPaymentRequired, ErrQuotaExceeded},
		{http.StatusTooManyRequests, ErrRateLimited},
		{http.StatusNotFound, ErrNotFound},
	}
	for _, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("X-API-Key"); got != "k" {
				t.Errorf("missing api key header, got %q", got)
			}
			w.WriteHeader(c.status)
		}))
		cl := NewWithBaseURL("k", srv.URL)
		_, err := cl.UsernameToUserId(context.Background(), "x")
		if !errors.Is(err, c.want) {
			t.Errorf("status %d: err = %v, want %v", c.status, err, c.want)
		}
		srv.Close()
	}
}

func TestClientNotConfigured(t *testing.T) {
	cl := New("")
	if cl.IsConfigured() {
		t.Fatal("empty key should not be configured")
	}
	if _, err := cl.UserTweets(context.Background(), "1", ""); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

func TestClientOKPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/UsernameToUserId" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("username") != "solana" {
			t.Errorf("username = %s", r.URL.Query().Get("username"))
		}
		_, _ = w.Write([]byte(`{"id":951329744804392960,"id_str":"951329744804392960"}`))
	}))
	defer srv.Close()
	cl := NewWithBaseURL("k", srv.URL)
	id, err := cl.UsernameToUserId(context.Background(), "solana")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if id != "951329744804392960" {
		t.Fatalf("id = %q", id)
	}
}
