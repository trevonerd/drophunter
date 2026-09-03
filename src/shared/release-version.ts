const CHROME_VERSION_COMPONENT_MAX = 65_535;
const V4_BETA_VERSION = /^4\.0\.0-beta\.(0|[1-9]\d*)$/;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type ReleaseVersion =
  | {
      readonly channel: 'beta';
      readonly manifestVersion: string;
      readonly versionName: string;
    }
  | {
      readonly channel: 'stable';
      readonly manifestVersion: string;
    };

export type DisplayManifestVersion = {
  readonly version: string;
  readonly version_name?: string;
};

export class ReleaseVersionError extends Error {
  readonly packageVersion: string;

  constructor(packageVersion: string) {
    super(`Unsupported DropHunter release version: ${packageVersion}`);
    this.name = 'ReleaseVersionError';
    this.packageVersion = packageVersion;
  }
}

function isChromeVersionComponent(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= CHROME_VERSION_COMPONENT_MAX;
}

export function resolveReleaseVersion(packageVersion: string): ReleaseVersion {
  const betaNumberText = V4_BETA_VERSION.exec(packageVersion)?.[1];
  if (betaNumberText !== undefined) {
    const betaNumber = Number(betaNumberText);
    if (!isChromeVersionComponent(betaNumber)) {
      throw new ReleaseVersionError(packageVersion);
    }
    return {
      channel: 'beta',
      manifestVersion: `3.99.0.${betaNumber}`,
      versionName: packageVersion,
    };
  }

  const stableMatch = STABLE_VERSION.exec(packageVersion);
  const stableComponents = stableMatch?.slice(1).map(Number);
  if (
    stableComponents === undefined ||
    stableComponents.every((component) => component === 0) ||
    !stableComponents.every(isChromeVersionComponent)
  ) {
    throw new ReleaseVersionError(packageVersion);
  }

  return {
    channel: 'stable',
    manifestVersion: packageVersion,
  };
}

export function displayManifestVersion(manifest: DisplayManifestVersion): string {
  return manifest.version_name ?? manifest.version;
}
