/** Backup images may only use Twitch's static CDN. Parsing never requests the URL. */
export function isTrustedBackupImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const authority = value.toLowerCase().startsWith('https://')
      ? value.slice(8).split('/')[0]?.split('?')[0]?.split('#')[0]
      : undefined;
    return (
      url.protocol === 'https:' &&
      url.hostname === 'static-cdn.jtvnw.net' &&
      !url.username &&
      !url.password &&
      !url.port &&
      authority?.toLowerCase() === 'static-cdn.jtvnw.net'
    );
  } catch {
    return false;
  }
}
