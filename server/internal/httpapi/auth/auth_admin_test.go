package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// stubAdminLookup 是 AdminLookup 的测试替身.
type stubAdminLookup struct {
	isAdmin bool
	err     error
}

func (s stubAdminLookup) IsAdmin(_ context.Context, _ uuid.UUID) (bool, error) {
	return s.isAdmin, s.err
}

// setUser 是一个测试中间件: 把指定 uid 写进 context, 模拟 Bearer 已认证.
// nil uid 表示"未认证"(不 set), 用于测 401 分支.
func setUser(uid *uuid.UUID) gin.HandlerFunc {
	return func(c *gin.Context) {
		if uid != nil {
			c.Set(contextKeyUserID, *uid)
		}
		c.Next()
	}
}

func runRequireAdmin(t *testing.T, uid *uuid.UUID, devUserID uuid.UUID, lookup AdminLookup) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(setUser(uid))
	r.GET("/x", RequireAdmin(lookup, devUserID), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	r.ServeHTTP(w, req)
	return w.Code
}

func TestRequireAdmin(t *testing.T) {
	dev := uuid.New()
	normal := uuid.New()

	tests := []struct {
		name      string
		uid       *uuid.UUID
		devUserID uuid.UUID
		lookup    AdminLookup
		want      int
	}{
		{"no user → 401", nil, dev, stubAdminLookup{}, http.StatusUnauthorized},
		{"dev user bypasses lookup → 200", &dev, dev, stubAdminLookup{isAdmin: false, err: errors.New("should not be called")}, http.StatusOK},
		{"admin user → 200", &normal, dev, stubAdminLookup{isAdmin: true}, http.StatusOK},
		{"non-admin user → 403", &normal, dev, stubAdminLookup{isAdmin: false}, http.StatusForbidden},
		{"lookup error → 500", &normal, dev, stubAdminLookup{err: errors.New("db down")}, http.StatusInternalServerError},
		{"nil lookup, non-dev → 403", &normal, dev, nil, http.StatusForbidden},
		{"nil devUserID never bypasses", &normal, uuid.Nil, stubAdminLookup{isAdmin: false}, http.StatusForbidden},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := runRequireAdmin(t, tc.uid, tc.devUserID, tc.lookup)
			if got != tc.want {
				t.Fatalf("RequireAdmin status = %d, want %d", got, tc.want)
			}
		})
	}
}
