package project

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

var ErrInvalidInput = errors.New("invalid input")

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

type CreateCommand struct {
	UserID    uuid.UUID
	Name      string
	Color     *string
	Emoji     *string
	SortOrder int
}

func (c *CreateCommand) Validate() error {
	name := strings.TrimSpace(c.Name)
	if name == "" {
		return fmt.Errorf("%w: name empty", ErrInvalidInput)
	}
	if utf8.RuneCountInString(name) > 40 {
		return fmt.Errorf("%w: name exceeds 40 chars", ErrInvalidInput)
	}
	c.Name = name
	if c.Color != nil {
		v := strings.TrimSpace(*c.Color)
		if v == "" {
			c.Color = nil
		} else if !looksLikeHex(v) {
			return fmt.Errorf("%w: color must be #RRGGBB", ErrInvalidInput)
		} else {
			c.Color = &v
		}
	}
	if c.Emoji != nil {
		v := strings.TrimSpace(*c.Emoji)
		if v == "" {
			c.Emoji = nil
		} else if utf8.RuneCountInString(v) > 4 {
			return fmt.Errorf("%w: emoji too long", ErrInvalidInput)
		} else {
			c.Emoji = &v
		}
	}
	return nil
}

func (s *Service) Create(ctx context.Context, cmd CreateCommand) (*Project, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	return s.repo.Create(ctx, CreateInput{
		UserID:    cmd.UserID,
		Name:      cmd.Name,
		Color:     cmd.Color,
		Emoji:     cmd.Emoji,
		SortOrder: cmd.SortOrder,
	})
}

func (s *Service) ListActive(ctx context.Context, userID uuid.UUID) ([]Project, error) {
	return s.repo.ListActive(ctx, userID)
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*Project, error) {
	return s.repo.Get(ctx, userID, id)
}

type UpdateCommand struct {
	UserID    uuid.UUID
	ID        uuid.UUID
	Name      *string
	Color     *string
	Emoji     *string
	SortOrder *int
}

func (c *UpdateCommand) Validate() error {
	if c.Name != nil {
		name := strings.TrimSpace(*c.Name)
		if name == "" {
			return fmt.Errorf("%w: name empty", ErrInvalidInput)
		}
		if utf8.RuneCountInString(name) > 40 {
			return fmt.Errorf("%w: name exceeds 40 chars", ErrInvalidInput)
		}
		c.Name = &name
	}
	if c.Color != nil {
		v := strings.TrimSpace(*c.Color)
		if v != "" && !looksLikeHex(v) {
			return fmt.Errorf("%w: color must be #RRGGBB", ErrInvalidInput)
		}
		if v == "" {
			c.Color = nil
		} else {
			c.Color = &v
		}
	}
	if c.Emoji != nil {
		v := strings.TrimSpace(*c.Emoji)
		if v != "" && utf8.RuneCountInString(v) > 4 {
			return fmt.Errorf("%w: emoji too long", ErrInvalidInput)
		}
		if v == "" {
			c.Emoji = nil
		} else {
			c.Emoji = &v
		}
	}
	return nil
}

func (s *Service) Update(ctx context.Context, cmd UpdateCommand) (*Project, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	return s.repo.Update(ctx, UpdateInput{
		UserID:    cmd.UserID,
		ID:        cmd.ID,
		Name:      cmd.Name,
		Color:     cmd.Color,
		Emoji:     cmd.Emoji,
		SortOrder: cmd.SortOrder,
	})
}

func (s *Service) Archive(ctx context.Context, userID, id uuid.UUID) error {
	return s.repo.Archive(ctx, userID, id)
}

// ValidateOwnership 给 signal capture 用: 确认 project_id 属于 user 且未归档.
// 用 sentinel ErrNotFound, 调用方转 400/404 自行决定.
func (s *Service) ValidateOwnership(ctx context.Context, userID, projectID uuid.UUID) error {
	ok, err := s.repo.Exists(ctx, userID, projectID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

// looksLikeHex 只做形状检查 (#RRGGBB), 不解析颜色空间.
func looksLikeHex(s string) bool {
	if len(s) != 7 || s[0] != '#' {
		return false
	}
	for _, r := range s[1:] {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}
