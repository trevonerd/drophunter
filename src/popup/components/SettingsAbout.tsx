import { browser } from '../../shared/browser-api.ts';
import { displayManifestVersion } from '../../shared/release-version.ts';
import { CoffeeIcon, GitHubIcon } from './icons.tsx';

function extensionVersion(): string {
  try {
    return displayManifestVersion(browser.runtime.getManifest());
  } catch {
    return 'dev';
  }
}

export function SettingsAbout() {
  return (
    <section className="dh-panel dh-contain px-3 py-2.5" aria-labelledby="settings-about-heading">
      <div className="dh-group">
        <h2 id="settings-about-heading" className="dh-title text-xs">
          About DropHunter
        </h2>
        <p className="text-sm font-bold text-[color:var(--dh-text)]">
          DropHunter <span className="text-purple-300 font-normal">v{extensionVersion()}</span>
        </p>
        <p className="dh-copy text-[11px]">
          by{' '}
          <a
            href="https://www.marcotrevisani.com"
            target="_blank"
            rel="noopener noreferrer"
            className="dh-focus cursor-pointer rounded text-[color:var(--dh-text-soft)] no-underline transition-colors hover:text-[color:var(--dh-text)]"
          >
            Marco Trevisani
          </a>{' '}
          (
          <a
            href="https://github.com/trevonerd"
            target="_blank"
            rel="noopener noreferrer"
            className="dh-focus cursor-pointer rounded text-[color:var(--dh-text-soft)] no-underline transition-colors hover:text-[color:var(--dh-text)]"
          >
            trevonerd
          </a>
          )
        </p>
        <a
          href="https://trevisoft.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="dh-focus cursor-pointer rounded text-[11px] font-semibold tracking-wide text-purple-300 no-underline transition-colors hover:text-purple-100"
        >
          TREVISOFT
        </a>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() =>
              void browser.tabs.create({ url: 'https://github.com/trevonerd/drophunter' }).catch(() => {})
            }
            className="dh-focus flex cursor-pointer items-center gap-1.5 rounded text-[11px] text-[color:var(--dh-text-soft)] transition-colors hover:text-[color:var(--dh-text)]"
            aria-label="Open DropHunter GitHub repository"
          >
            <GitHubIcon />
            GitHub
          </button>
          <button
            type="button"
            onClick={() =>
              void browser.tabs.create({ url: 'https://buymeacoffee.com/trevonerd' }).catch(() => {})
            }
            className="dh-coffee-button dh-focus flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
            aria-label="Open Buy Me a Coffee"
          >
            <CoffeeIcon />
            Buy Me a Coffee
          </button>
        </div>
      </div>
    </section>
  );
}
