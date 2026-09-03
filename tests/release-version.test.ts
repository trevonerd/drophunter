import { describe, expect, test } from 'bun:test';
import {
  displayManifestVersion,
  ReleaseVersionError,
  resolveReleaseVersion,
} from '../src/shared/release-version.ts';

describe('release version contract', () => {
  test('maps the current public beta to a lower technical manifest version', () => {
    // Given
    const packageVersion = '4.0.0-beta.14';

    // When
    const result = resolveReleaseVersion(packageVersion);

    // Then
    expect(result).toEqual({
      channel: 'beta',
      manifestVersion: '3.99.0.14',
      versionName: '4.0.0-beta.14',
    });
  });

  test('keeps a stable package version unchanged', () => {
    // Given
    const packageVersion = '4.0.0';

    // When
    const result = resolveReleaseVersion(packageVersion);

    // Then
    expect(result).toEqual({
      channel: 'stable',
      manifestVersion: '4.0.0',
    });
  });

  test('rejects a beta number that Chrome cannot represent', () => {
    // Given
    const packageVersion = '4.0.0-beta.65536';

    // When
    const resolve = () => resolveReleaseVersion(packageVersion);

    // Then
    expect(resolve).toThrow(ReleaseVersionError);
  });

  test('rejects an unsupported package version', () => {
    // Given
    const packageVersion = '4.0.0-rc.1';

    // When
    const resolve = () => resolveReleaseVersion(packageVersion);

    // Then
    expect(resolve).toThrow(ReleaseVersionError);
  });

  test('keeps the future stable above every beta in the reserved band', () => {
    // Given
    const beta = resolveReleaseVersion('4.0.0-beta.65535');
    const stable = resolveReleaseVersion('4.0.0');

    // When
    const betaParts = beta.manifestVersion.split('.').map(Number);
    const stableParts = stable.manifestVersion.split('.').map(Number);

    // Then
    expect(stableParts[0]).toBeGreaterThan(betaParts[0]);
  });

  test('prefers the descriptive manifest version in the UI', () => {
    // Given
    const betaManifest = { version: '3.99.0.14', version_name: '4.0.0-beta.14' };
    const stableManifest = { version: '4.0.0' };

    // When
    const betaLabel = displayManifestVersion(betaManifest);
    const stableLabel = displayManifestVersion(stableManifest);

    // Then
    expect(betaLabel).toBe('4.0.0-beta.14');
    expect(stableLabel).toBe('4.0.0');
  });
});
