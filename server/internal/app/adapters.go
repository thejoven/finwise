// Package app is the composition root: it wires every module together and owns
// the process lifecycle (HTTP server + background workers). main() stays a thin
// entrypoint — all assembly lives here.
//
// adapters.go holds the cross-module glue. These funcs deliberately live in the
// composition root (not inside the modules) so that, e.g., signal never imports
// project and subscription never imports asset — the wiring layer is the only
// place that knows about more than one module. They were previously anonymous
// closures buried in main.go's run(); naming them keeps main an entrypoint and
// makes each piece of cross-module policy reviewable on its own.
package app

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	accountmod "alphax/server/internal/module/account"
	assetmod "alphax/server/internal/module/asset"
	invitemod "alphax/server/internal/module/invite"
	projectmod "alphax/server/internal/module/project"
	refinementmod "alphax/server/internal/module/refinement"
	reportmod "alphax/server/internal/module/report"
	signalmod "alphax/server/internal/module/signal"
)

// inviteGate adapts invite.Service to account's registration gate. Redeem maps
// invite.ErrNotRedeemable → account.ErrInviteInvalid so account never imports
// invite's sentinel.
func inviteGate(inviteSvc *invitemod.Service) accountmod.InviteGateFuncs {
	return accountmod.InviteGateFuncs{
		Redeem: func(ctx context.Context, code string) error {
			if err := inviteSvc.Redeem(ctx, code); err != nil {
				if errors.Is(err, invitemod.ErrNotRedeemable) {
					return accountmod.ErrInviteInvalid
				}
				return err
			}
			return nil
		},
		Refund: func(ctx context.Context, code string) error {
			return inviteSvc.Refund(ctx, code)
		},
	}
}

// provisionDefaultProject is account.Register's post-create hook: build the new
// user's default category (same name as mobile useEnsureCategory) so the
// "signal never uncategorized → falls to firstActive" guarantee holds from
// signup. best-effort: a duplicate (race with mobile) counts as success; other
// errors are logged but do not block registration.
func provisionDefaultProject(projectSvc *projectmod.Service, logger *zap.Logger) func(context.Context, uuid.UUID) error {
	return func(ctx context.Context, userID uuid.UUID) error {
		if _, err := projectSvc.Create(ctx, projectmod.CreateCommand{
			UserID: userID,
			Name:   projectmod.DefaultName,
		}); err != nil && !errors.Is(err, projectmod.ErrDuplicateName) {
			logger.Warn("provision default project failed (ignored)",
				zap.String("user_id", userID.String()), zap.Error(err))
			return err
		}
		return nil
	}
}

// signalProjectValidator backs signal.Capture's project_id ownership check:
// the request's project_id must belong to the user and not be archived.
// Maps project.ErrNotFound → signal.ErrInvalidProject.
func signalProjectValidator(projectSvc *projectmod.Service) func(context.Context, uuid.UUID, uuid.UUID) error {
	return func(ctx context.Context, userID, projectID uuid.UUID) error {
		err := projectSvc.ValidateOwnership(ctx, userID, projectID)
		if err != nil {
			if errors.Is(err, projectmod.ErrNotFound) {
				return signalmod.ErrInvalidProject
			}
			return err
		}
		return nil
	}
}

// firstActiveProject backs signal.RecordInference's fallback: when a signal is
// uncategorized and the AI abstains, drop it into the user's first active
// category (same order as mobile useEnsureCategory) so a signal always has an
// owner and stays visible.
func firstActiveProject(projectSvc *projectmod.Service) func(context.Context, uuid.UUID) (*uuid.UUID, error) {
	return func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
		actives, err := projectSvc.ListActive(ctx, userID)
		if err != nil || len(actives) == 0 {
			return nil, err
		}
		return &actives[0].ID, nil
	}
}

// refinementSignalOwner backs refinement.Start's check that primary_signal_id
// belongs to the user. signal.Get is user-filtered, so a foreign signal returns
// signal.ErrNotFound.
func refinementSignalOwner(signalSvc *signalmod.Service) func(context.Context, uuid.UUID, uuid.UUID) error {
	return func(ctx context.Context, userID, signalID uuid.UUID) error {
		_, err := signalSvc.Get(ctx, userID, signalID)
		return err
	}
}

// researchSessionLookup lets research resolve session ownership + primary_signal_id
// via refinement, avoiding a research → refinement reverse import.
func researchSessionLookup(refinementSvc *refinementmod.Service) func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, bool, error) {
	return func(ctx context.Context, userID, sessionID uuid.UUID) (uuid.UUID, bool, error) {
		view, err := refinementSvc.Get(ctx, userID, sessionID)
		if err != nil {
			if errors.Is(err, refinementmod.ErrNotFound) {
				return uuid.Nil, false, nil
			}
			return uuid.Nil, false, err
		}
		return view.PrimarySignalID, true, nil
	}
}

// subscriptionPromote turns a saved tweet into a signal via signal.Capture
// (same main-wiring pattern as exit→retrospect, no reverse import). promote
// fallback categorization: drop into the user's first active category
// (provisional, auto_assigned) so the signal is immediately visible; mastra's
// analyst later overwrites it to a better category. An AI fault never loses the
// signal (the product has no uncategorized view).
func subscriptionPromote(projectSvc *projectmod.Service, signalSvc *signalmod.Service) func(context.Context, uuid.UUID, uuid.UUID, string) (uuid.UUID, bool, error) {
	return func(ctx context.Context, userID, clientEventID uuid.UUID, rawText string) (uuid.UUID, bool, error) {
		var pid *uuid.UUID
		if actives, perr := projectSvc.ListActive(ctx, userID); perr == nil && len(actives) > 0 {
			pid = &actives[0].ID
		}
		res, err := signalSvc.Capture(ctx, signalmod.CaptureCommand{
			UserID:              userID,
			ClientEventID:       clientEventID,
			ProjectID:           pid,
			ProjectAutoAssigned: pid != nil,
			RawText:             rawText,
			OccurredAt:          time.Now().UTC(),
		})
		if err != nil {
			return uuid.Nil, false, err
		}
		return res.Signal.ID, res.Duplicate, nil
	}
}

// resolveSignalAssetsAsync normalizes a freshly-inferred signal's related_assets
// into signal_assets right after inference lands (async best-effort, does not
// block the inference write-back). Wired into signal so signal never imports
// asset; normalization failures are covered by cmd/asset-backfill + the manual
// endpoint.
func resolveSignalAssetsAsync(assetSvc *assetmod.Service, logger *zap.Logger) func(context.Context, uuid.UUID, uuid.UUID) {
	return func(_ context.Context, _, signalID uuid.UUID) {
		go func() {
			bg, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			if err := assetSvc.ResolveSignal(bg, signalID); err != nil {
				logger.Warn("realtime resolve signal failed",
					zap.String("signal", signalID.String()), zap.Error(err))
			}
		}()
	}
}

// reportDeps supplies the per-user personalization inputs the morning report
// needs (tracked assets, active themes, language), each via a closure so report
// never reverse-imports asset/project/account.
func reportDeps(assetSvc *assetmod.Service, projectSvc *projectmod.Service, accountSvc *accountmod.Service) reportmod.Deps {
	return reportmod.Deps{
		TrackedAssets: func(ctx context.Context, userID uuid.UUID) ([]string, error) {
			cards, err := assetSvc.TrackedAssetCards(ctx, userID)
			if err != nil {
				return nil, err
			}
			toks := make([]string, 0, len(cards)*2)
			for _, card := range cards {
				if card.Asset.Canonical != "" {
					toks = append(toks, card.Asset.Canonical)
				}
				if card.Asset.Name != "" {
					toks = append(toks, card.Asset.Name)
				}
			}
			return toks, nil
		},
		ActiveThemes: func(ctx context.Context, userID uuid.UUID) ([]string, error) {
			ps, err := projectSvc.ListActive(ctx, userID)
			if err != nil {
				return nil, err
			}
			toks := make([]string, 0, len(ps)*2)
			for _, p := range ps {
				if p.Name != "" {
					toks = append(toks, p.Name)
				}
				if p.Guidance != nil && *p.Guidance != "" {
					toks = append(toks, *p.Guidance)
				}
			}
			return toks, nil
		},
		UserLanguage: func(ctx context.Context, userID uuid.UUID) (string, error) {
			u, err := accountSvc.GetMe(ctx, userID)
			if err != nil {
				return "", err
			}
			if u.Language != nil {
				return *u.Language, nil
			}
			return "", nil
		},
	}
}
