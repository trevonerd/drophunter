import { type Dispatch, type RefObject, type SetStateAction, useEffect } from 'react';
import { ClaimLogView } from './ClaimLogView';
import { MainView } from './MainView';
import type { MainViewProps } from './main-view-types';
import { SettingsView } from './SettingsView';
import type { SettingsViewProps } from './settings-view-types';

export type PopupViewName = 'main' | 'settings' | 'log';

interface PopupViewProps {
  readonly loading: boolean;
  readonly activeView: PopupViewName;
  readonly setActiveView: Dispatch<SetStateAction<PopupViewName>>;
  readonly viewContainerRef: RefObject<HTMLDivElement | null>;
  readonly mainViewProps: Omit<MainViewProps, 'onOpenDropsPage' | 'onOpenSettings' | 'onRefreshCampaigns'>;
  readonly openDropsPage: () => Promise<void>;
  readonly settingsViewProps: Omit<SettingsViewProps, 'onBack' | 'onOpenClaimLog'>;
}

export function PopupView({
  loading,
  activeView,
  setActiveView,
  viewContainerRef,
  mainViewProps,
  openDropsPage,
  settingsViewProps,
}: PopupViewProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeView triggers refocus but isn't read in the body
  useEffect(() => {
    viewContainerRef.current?.focus();
  }, [activeView]);

  if (loading) {
    return (
      <main
        className="dh-view flex items-center justify-center py-12 text-[color:var(--dh-text-soft)]"
        role="status"
        aria-live="polite"
      >
        <div className="spinner rounded-full h-8 w-8 border-[3px] border-twitch-purple border-t-transparent" />
      </main>
    );
  }

  return (
    <div
      ref={viewContainerRef}
      tabIndex={-1}
      className="dh-view w-full max-w-[400px] text-[color:var(--dh-text)] outline-none"
    >
      {activeView === 'log' ? (
        <ClaimLogView onBack={() => setActiveView('settings')} />
      ) : activeView === 'settings' ? (
        <SettingsView
          {...settingsViewProps}
          onBack={() => setActiveView('main')}
          onOpenClaimLog={() => setActiveView('log')}
        />
      ) : (
        <MainView
          {...mainViewProps}
          onOpenDropsPage={() => void openDropsPage()}
          onOpenSettings={() => setActiveView('settings')}
          onRefreshCampaigns={() => void openDropsPage()}
        />
      )}
    </div>
  );
}
