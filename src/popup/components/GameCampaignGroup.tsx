import { gameKey } from '../../shared/game-selection.ts';
import type { GamePreference, TwitchDrop, TwitchGame } from '../../types';
import { CampaignDetail } from './CampaignDetail';
import {
  type CampaignGameGroup,
  type CampaignProgressLookup,
  isCampaignFarmingComplete,
  isCampaignQueueEligible,
  isSubscriptionOnlyCampaign,
} from './campaign-list-model';
import { CheckIcon, EyeOffIcon, LockIcon } from './icons';

interface GameCampaignGroupProps {
  readonly group: CampaignGameGroup;
  readonly allDrops: readonly TwitchDrop[];
  readonly favorite: boolean;
  readonly hidden: boolean;
  readonly queueGames: readonly TwitchGame[];
  readonly loadedCampaignKeys: ReadonlySet<string>;
  readonly refreshDelayed?: boolean;
  readonly expanded: boolean;
  readonly progressByCampaignKey?: CampaignProgressLookup;
  readonly highlightedCampaignKey: string | null;
  readonly actionLoading: boolean;
  readonly now: number;
  readonly runningGame?: TwitchGame | null;
  readonly onToggleGame: (key: string) => void;
  readonly onSetFavorite?: (game: TwitchGame, favorite: boolean) => void;
  readonly onSetGamePreference?: (
    game: TwitchGame,
    preference: GamePreference,
    undoPreference: GamePreference,
  ) => void;
  readonly onAddToQueue?: (game: TwitchGame) => void;
  readonly onAddAllToQueue?: (games: readonly TwitchGame[]) => void;
  readonly onRemoveFromQueue?: (game: TwitchGame) => void;
  readonly onLinkAccount?: (game: TwitchGame) => void;
}

function isQueued(game: TwitchGame, queueGames: readonly TwitchGame[]): boolean {
  const key = gameKey(game);
  return queueGames.some((queued) => gameKey(queued) === key);
}

function FavoriteStar({ filled }: { readonly filled: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path
        d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.53l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GameCampaignGroup(props: GameCampaignGroupProps) {
  const representative = props.group.campaigns[0];
  if (!representative) return null;
  const detailId = `game-campaigns-${props.group.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const runningKey = props.runningGame ? gameKey(props.runningGame) : null;
  const running = props.group.campaigns.some((game) => gameKey(game) === runningKey);
  const queuePositions = props.group.campaigns
    .flatMap((game) => {
      if (gameKey(game) === runningKey) return [];
      const index = props.queueGames.findIndex((queued) => isQueued(game, [queued]));
      return index >= 0 ? [index + 1] : [];
    })
    .sort((left, right) => left - right);
  const completed = props.group.campaigns.every(isCampaignFarmingComplete);
  const needsLink = props.group.campaigns.some(
    (game) => !isCampaignFarmingComplete(game) && game.isConnected === false,
  );
  const addableCampaigns = props.group.campaigns.filter((game) => {
    const key = gameKey(game);
    const loaded =
      props.loadedCampaignKeys.has(key) || props.allDrops.some((drop) => drop.campaignId === game.campaignId);
    return (
      key !== runningKey &&
      !isQueued(game, props.queueGames) &&
      isCampaignQueueEligible(game, props.allDrops, loaded)
    );
  });
  const subscriptionOnly =
    addableCampaigns.length === 0 &&
    props.group.campaigns.some((game) =>
      isSubscriptionOnlyCampaign(
        game,
        props.allDrops,
        props.loadedCampaignKeys.has(gameKey(game)) ||
          props.allDrops.some((drop) => drop.campaignId === game.campaignId),
      ),
    );
  const highlighted = props.group.campaigns.some((game) => gameKey(game) === props.highlightedCampaignKey);
  const setPreference = (preference: GamePreference, undoPreference: GamePreference) => {
    if (props.onSetGamePreference) {
      props.onSetGamePreference(representative, preference, undoPreference);
      return;
    }
    if (preference === 'favorite' || preference === 'normal') {
      props.onSetFavorite?.(representative, preference === 'favorite');
    }
  };
  return (
    <li
      data-game-key={props.group.key}
      data-expanded={props.expanded ? 'true' : 'false'}
      data-running={running ? 'true' : 'false'}
      data-subscription-only={subscriptionOnly ? 'true' : 'false'}
      className={`dh-panel min-w-0 overflow-hidden p-0 ${running ? 'dh-game-group--running' : ''} ${subscriptionOnly ? 'dh-game-group--subscription-only' : ''} ${highlighted ? 'ring-1 ring-[color:var(--dh-accent)]' : ''}`}
    >
      <div data-game-summary="true" className="flex min-h-10 min-w-0 items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          className="dh-focus group flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors duration-[180ms] ease-[var(--dh-ease)] hover:bg-[color:var(--dh-surface-3)]"
          aria-expanded={props.expanded}
          aria-controls={detailId}
          onClick={() => props.onToggleGame(props.group.key)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-[180ms] ease-[var(--dh-ease)] ${props.expanded ? 'rotate-90' : ''}`}
          >
            <path
              d="m9 5 7 7-7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-semibold leading-tight text-[color:var(--dh-text)]">
              {props.group.name}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[9px] leading-none text-[color:var(--dh-muted)]">
              <span className="dh-game-campaign-count shrink-0">
                {props.group.campaigns.length} {props.group.campaigns.length === 1 ? 'campaign' : 'campaigns'}
              </span>
              {completed && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-green-500/15 px-1 py-px font-semibold text-green-300">
                  <CheckIcon /> Complete
                </span>
              )}
              {needsLink && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-orange-400/10 px-1 py-px font-semibold text-orange-300">
                  <LockIcon /> Not linked
                </span>
              )}
              {queuePositions.length > 0 && (
                <span className="shrink-0 rounded bg-blue-400/10 px-1 py-px font-semibold text-blue-300">
                  Queue {queuePositions.map((position) => `#${position}`).join(', ')}
                </span>
              )}
              {running && <span className="dh-running-badge">Running</span>}
            </span>
          </span>
        </button>
        {!props.hidden && (
          <button
            type="button"
            className="dh-game-hide-action dh-focus inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[color:var(--dh-muted)] transition-[background-color,opacity,color] duration-[180ms] ease-[var(--dh-ease)] hover:bg-[color:var(--dh-surface-3)] hover:text-[color:var(--dh-text)]"
            aria-label={`Hide ${props.group.name}`}
            title={`Hide ${props.group.name}`}
            onClick={() => setPreference('hidden', props.favorite ? 'favorite' : 'normal')}
            disabled={props.actionLoading || !props.onSetGamePreference}
          >
            <EyeOffIcon />
          </button>
        )}
        <button
          type="button"
          className="dh-focus inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[color:var(--dh-warning)] transition-colors duration-[180ms] ease-[var(--dh-ease)] hover:bg-[color:var(--dh-surface-3)] disabled:opacity-55"
          aria-pressed={props.favorite}
          aria-label={
            props.hidden
              ? `Restore ${props.group.name} as a favorite game`
              : `${props.favorite ? 'Remove' : 'Add'} ${props.group.name} ${props.favorite ? 'from' : 'to'} favorite games`
          }
          title={
            props.hidden
              ? 'Restore as favorite'
              : props.favorite
                ? 'Remove from favorite games'
                : 'Add to favorite games'
          }
          onClick={() =>
            setPreference(
              props.favorite ? 'normal' : 'favorite',
              props.hidden ? 'hidden' : props.favorite ? 'favorite' : 'normal',
            )
          }
          disabled={props.actionLoading || (!props.onSetFavorite && !props.onSetGamePreference)}
        >
          <FavoriteStar filled={props.favorite} />
        </button>
        <span
          className="inline-flex"
          title={subscriptionOnly ? 'This game only has subscription rewards available.' : undefined}
        >
          <button
            type="button"
            className="dh-action-secondary dh-focus h-7 shrink-0 rounded-md px-2 text-[10px] font-semibold disabled:opacity-45"
            aria-label={
              props.hidden
                ? `Restore ${props.group.name} to available games`
                : addableCampaigns.length > 0
                  ? `Add all available ${props.group.name} campaigns to queue`
                  : completed
                    ? `All ${props.group.name} campaigns are complete`
                    : `No more ${props.group.name} campaigns can be added`
            }
            onClick={() =>
              props.hidden
                ? setPreference('normal', 'hidden')
                : addableCampaigns.length > 0 && props.onAddAllToQueue?.(addableCampaigns)
            }
            disabled={
              props.actionLoading ||
              (props.hidden
                ? !props.onSetGamePreference
                : addableCampaigns.length === 0 || !props.onAddAllToQueue)
            }
          >
            {props.hidden ? 'Restore' : 'Add'}
          </button>
        </span>
      </div>
      <div
        id={detailId}
        data-game-detail="true"
        hidden={!props.expanded}
        className="border-t border-[color:var(--dh-border)] bg-[color:var(--dh-surface-1)]"
      >
        {props.group.campaigns.map((game) => (
          <CampaignDetail
            key={gameKey(game)}
            game={game}
            allDrops={props.allDrops}
            queueGames={props.queueGames}
            loadedCampaignKeys={props.loadedCampaignKeys}
            refreshDelayed={props.refreshDelayed}
            progressByCampaignKey={props.progressByCampaignKey}
            highlightedCampaignKey={props.highlightedCampaignKey}
            actionLoading={props.actionLoading}
            now={props.now}
            running={gameKey(game) === runningKey}
            hidden={props.hidden}
            onAddToQueue={props.onAddToQueue}
            onRemoveFromQueue={props.onRemoveFromQueue}
            onLinkAccount={props.onLinkAccount}
          />
        ))}
      </div>
    </li>
  );
}
