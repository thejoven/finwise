// Command admin 是管理员引导/管理 CLI.
//
// 用途: 在部署环境里把某个邮箱设为/取消管理员. 邮箱不存在时可用 -password 直接创建.
// 复用 account.Service, 所以密码哈希、邮箱校验跟正常注册完全一致 (不会手搓 bcrypt).
//
// 用法 (需要 DATABASE_URL 环境变量, 或 -dsn):
//
//	# 创建 (若不存在) 并设为管理员:
//	go run ./cmd/admin -email jwen@vip.qq.com -password 'S0meStr0ngPw'
//
//	# 已存在的用户, 只提权 (不动密码), 可省略 -password:
//	go run ./cmd/admin -email jwen@vip.qq.com
//
//	# 取消管理员:
//	go run ./cmd/admin -email someone@example.com -revoke
//
// 在 205 服务器上 (Postgres 跑 docker compose) 推荐用 scripts/grant-admin.sh 包一层.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"wiseflow/server/internal/infra/db"
	accountmod "wiseflow/server/internal/module/account"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "admin: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		email    = flag.String("email", "", "目标用户邮箱 (必填)")
		password = flag.String("password", "", "新建用户时的密码 (用户已存在则忽略)")
		revoke   = flag.Bool("revoke", false, "取消管理员 (而非授予)")
		dsn      = flag.String("dsn", os.Getenv("DATABASE_URL"), "Postgres DSN, 默认取 $DATABASE_URL")
	)
	flag.Parse()

	if *email == "" {
		return errors.New("-email 必填")
	}
	if *dsn == "" {
		return errors.New("缺少 DATABASE_URL (或 -dsn)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := db.Open(ctx, *dsn)
	if err != nil {
		return fmt.Errorf("连接数据库: %w", err)
	}
	defer pool.Close()

	// nil invite gate + nil provisioner: 本 CLI 走 EnsureAdmin 引导管理员, 不经 Register
	// 注册路径, 所以既不需要邀请码门禁, 也不预置默认分类.
	svc := accountmod.NewService(accountmod.NewRepository(pool), nil, nil)

	if *revoke {
		u, err := svc.SetAdmin(ctx, *email, false)
		if err != nil {
			if errors.Is(err, accountmod.ErrNotFound) {
				return fmt.Errorf("用户不存在: %s", *email)
			}
			return err
		}
		fmt.Printf("✓ 已取消管理员: %s (is_admin=%v)\n", u.Email, u.IsAdmin)
		return nil
	}

	u, created, err := svc.EnsureAdmin(ctx, *email, *password)
	if err != nil {
		return err
	}
	if created {
		fmt.Printf("✓ 已创建并设为管理员: %s (id=%s)\n", u.Email, u.ID)
		fmt.Println("  提醒: 该用户应尽快用 /v1/me/password 修改初始密码.")
	} else {
		fmt.Printf("✓ 已设为管理员 (用户已存在, 密码未改动): %s (is_admin=%v)\n", u.Email, u.IsAdmin)
	}
	return nil
}
