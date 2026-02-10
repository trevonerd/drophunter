import { DropsSnapshot, ExpiryStatus, Message, TwitchDrop, TwitchGame } from '../types';

const DROPS_PATH = '/drops/campaigns';
const INVENTORY_PATH = '/drops/inventory';
const DROPS_TAG_ID = 'c2542d6d-cd10-4532-919b-3d19f30a768b';
const LOG_PREFIX = '[DropHunter]';

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function toId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractCategorySlugFromHref(href: string): string | null {
  const match = href.match(/\/directory\/category\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function normalizeForCompare(value: string): string {
  const lower = value.toLowerCase();
  const normalized = typeof lower.normalize === 'function' ? lower.normalize('NFD') : lower;
  return normalized
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRewardAssetUrl(url: string): boolean {
  return /twitch-quests-assets\/REWARD\//i.test(url) || /\/REWARD\//.test(url);
}

function getImageUrl(image: HTMLImageElement | null | undefined): string {
  if (!image) {
    return '';
  }
  return normalizeText(image.currentSrc || image.src || '');
}

function isLikelyDateRangeText(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes(' - ') &&
    /\d{1,2}:\d{2}/.test(normalized) &&
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(normalized)
  );
}

function getAccordionButtons(): HTMLButtonElement[] {
  const nodes = Array.from(document.querySelectorAll('[role="heading"] button[aria-expanded], .accordion-header button[aria-expanded]'));
  const seen = new Set<HTMLButtonElement>();
  const buttons: HTMLButtonElement[] = [];
  nodes.forEach((node) => {
    if (node instanceof HTMLButtonElement && !seen.has(node)) {
      seen.add(node);
      buttons.push(node);
    }
  });
  return buttons;
}

function getAccordionHeader(button: HTMLButtonElement): Element | null {
  return button.closest('[role="heading"], .accordion-header');
}

function countAccordionButtons(scope: Element): number {
  return scope.querySelectorAll('[role="heading"] button[aria-expanded], .accordion-header button[aria-expanded]').length;
}

function extractHeaderTitle(header: Element | null): string {
  if (!header) {
    return '';
  }

  const imageAlt = normalizeText((header.querySelector('img[alt]') as HTMLImageElement | null)?.getAttribute('alt'));
  if (imageAlt) {
    return imageAlt;
  }

  const textNodes = Array.from(header.querySelectorAll('p, h2, h3, h4, strong, span, a'))
    .map((node) => normalizeText(node.textContent))
    .filter((text) => text.length > 1 && !isLikelyDateRangeText(text));
  const ignored = new Set(['summary', 'rewards', 'watch to redeem']);
  const candidate = textNodes.find((text) => !ignored.has(text.toLowerCase()));
  if (candidate) {
    return candidate;
  }

  return normalizeText(header.textContent);
}

function findCampaignBlockFromHeader(header: Element | null): Element | null {
  if (!header) {
    return null;
  }

  let current: Element | null = header.parentElement;
  const fallback = header.parentElement;
  while (current && current !== document.body) {
    const hasRewardImage = Array.from(current.querySelectorAll('img')).some(
      (node) => node instanceof HTMLImageElement && isRewardAssetUrl(getImageUrl(node))
    );
    const hasRewardsText = normalizeForCompare(current.textContent ?? '').includes('rewards');
    const accordionButtons = countAccordionButtons(current);
    if ((hasRewardImage || hasRewardsText) && accordionButtons <= 1) {
      return current;
    }
    if (accordionButtons > 1 && current !== fallback) {
      break;
    }
    current = current.parentElement;
  }

  return fallback;
}

function blockHasRewards(block: Element | null): boolean {
  if (!block) {
    return false;
  }
  const textHasRewards = normalizeForCompare(block.textContent ?? '').includes('rewards');
  const hasRewardImages = Array.from(block.querySelectorAll('img')).some(
    (node) => node instanceof HTMLImageElement && isRewardAssetUrl(getImageUrl(node))
  );
  return textHasRewards || hasRewardImages;
}

function extractCampaignBlocks(): Element[] {
  const blocks = new Set<Element>();

  getAccordionButtons().forEach((button) => {
    const block = findCampaignBlockFromHeader(getAccordionHeader(button));
    if (block && blockHasRewards(block)) {
      blocks.add(block);
    }
  });

  const legacyFallback = Array.from(
    document.querySelectorAll('.iSIERH, [data-test-selector="DropsCampaignInProgressDescription"], [data-test-selector="campaign-card"]')
  );
  legacyFallback.forEach((node) => {
    if (node instanceof Element && blockHasRewards(node)) {
      blocks.add(node);
    }
  });

  return Array.from(blocks);
}

function findAccordionButtonsByGameName(selectedGameName?: string): HTMLButtonElement[] {
  if (!selectedGameName) {
    return [];
  }
  const targetName = normalizeForCompare(selectedGameName);
  if (!targetName) {
    return [];
  }
  const targetTokens = new Set(targetName.split(' ').filter(Boolean));

  const buttons = getAccordionButtons();
  if (buttons.length === 0) {
    return [];
  }

  const scored = buttons
    .map((button) => {
      const header = getAccordionHeader(button);
      const title = normalizeForCompare(extractHeaderTitle(header));
      const titleTokens = new Set(title.split(' ').filter(Boolean));
      let score = 0;
      if (title === targetName) {
        score += 100;
      }
      if (title.includes(targetName) || targetName.includes(title)) {
        score += 30;
      }
      targetTokens.forEach((token) => {
        if (token.length >= 2 && titleTokens.has(token)) {
          score += 8;
        }
      });
      return { button, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return [];
  }

  return scored.filter((item) => item.score >= 20).map((item) => item.button);
}

async function ensureAccordionExpanded(selectedGameName?: string, fallbackToFirst = false): Promise<boolean> {
  if (!window.location.pathname.includes(DROPS_PATH)) {
    return false;
  }

  const buttons = getAccordionButtons();
  if (buttons.length === 0) {
    return false;
  }

  const matchedButtons = findAccordionButtonsByGameName(selectedGameName);
  const targetButtons = matchedButtons.length > 0 ? [...matchedButtons] : [];

  if (matchedButtons.length > 0) {
    const matchedImageTokens = new Set(
      matchedButtons
        .map((button) => {
          const src = getImageUrl(getAccordionHeader(button)?.querySelector('img') as HTMLImageElement | null);
          const boxartToken = src.match(/ttv-boxart\/([^_/?]+)/)?.[1] ?? '';
          return boxartToken;
        })
        .filter((token) => token.length > 0),
    );

    if (matchedImageTokens.size > 0) {
      buttons.forEach((button) => {
        if (targetButtons.includes(button)) {
          return;
        }
        const src = getImageUrl(getAccordionHeader(button)?.querySelector('img') as HTMLImageElement | null);
        const boxartToken = src.match(/ttv-boxart\/([^_/?]+)/)?.[1] ?? '';
        if (boxartToken && matchedImageTokens.has(boxartToken)) {
          targetButtons.push(button);
        }
      });
    }
  }

  if (targetButtons.length === 0 && fallbackToFirst) {
    const firstClosed = buttons.find((button) => button.getAttribute('aria-expanded') === 'false');
    if (firstClosed) {
      targetButtons.push(firstClosed);
    }
  }

  if (targetButtons.length === 0) {
    return false;
  }

  let expandedAny = false;
  for (const targetButton of targetButtons) {
    if (targetButton.getAttribute('aria-expanded') === 'false') {
      const header = getAccordionHeader(targetButton);
      const block = findCampaignBlockFromHeader(header);
      targetButton.click();
      expandedAny = true;
      for (let i = 0; i < 8; i += 1) {
        const expanded = targetButton.getAttribute('aria-expanded') === 'true';
        const hasRewards = blockHasRewards(block);
        if (expanded && hasRewards) {
          break;
        }
        await delay(250);
      }
    }
  }

  if (expandedAny) {
    return true;
  }

  return targetButtons.some((button) => button.getAttribute('aria-expanded') === 'true');
}

function parseProgress(container: Element): number {
  const progressEl = container.querySelector('[role="progressbar"], [aria-valuenow]');
  if (progressEl) {
    const ariaValue = progressEl.getAttribute('aria-valuenow');
    if (ariaValue) {
      const parsed = Number.parseInt(ariaValue, 10);
      if (!Number.isNaN(parsed)) {
        return Math.max(0, Math.min(100, parsed));
      }
    }
  }

  const textMatch = container.textContent?.match(/(\d{1,3})\s*%/);
  if (textMatch) {
    const parsed = Number.parseInt(textMatch[1], 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, Math.min(100, parsed));
    }
  }

  return 0;
}

function parseRequiredMinutesFromText(text: string): number | null {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return null;
  }

  const hoursMatch = normalized.match(/of\s+(\d+(?:[.,]\d+)?)\s*hours?/);
  if (hoursMatch?.[1]) {
    const value = Number.parseFloat(hoursMatch[1].replace(',', '.'));
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value * 60);
    }
  }

  const minutesMatch = normalized.match(/of\s+(\d+(?:[.,]\d+)?)\s*minutes?/);
  if (minutesMatch?.[1]) {
    const value = Number.parseFloat(minutesMatch[1].replace(',', '.'));
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
  }

  return null;
}

function computeRemainingMinutes(progress: number, requiredMinutes: number | null, claimed: boolean): number | null {
  if (claimed) {
    return 0;
  }
  if (requiredMinutes === null || requiredMinutes <= 0) {
    return null;
  }
  const bounded = Math.max(0, Math.min(100, progress));
  return Math.max(0, Math.round((requiredMinutes * (100 - bounded)) / 100));
}

function parseEndsAt(container: Element): string | null {
  const timeEl = container.querySelector('time[datetime]');
  const datetime = timeEl?.getAttribute('datetime');
  if (datetime) {
    const parsed = new Date(datetime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function parseEndDateFromRangeText(rangeText: string): string | null {
  const normalized = normalizeText(rangeText);
  const parts = normalized.split(' - ');
  const endPart = parts.length > 1 ? parts[parts.length - 1] : normalized;
  const match = endPart.match(/(?:[A-Za-z]{3}\s+)?(\d{1,2})\s+([A-Za-z]{3}),\s+(\d{1,2}:\d{2})(?:\s+([A-Z]{2,5}))?/);
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  const monthToken = match[2].toLowerCase();
  const time = match[3];
  const zone = (match[4] ?? '').toUpperCase();
  const monthMap: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const month = monthMap[monthToken];
  if (!month) {
    return null;
  }

  const now = new Date();
  let year = now.getFullYear();
  if (month < now.getMonth() + 1 - 6) {
    year += 1;
  }

  const tzOffsets: Record<string, string> = {
    CET: '+01:00',
    CEST: '+02:00',
    UTC: '+00:00',
    GMT: '+00:00',
    PST: '-08:00',
    PDT: '-07:00',
    EST: '-05:00',
    EDT: '-04:00',
  };
  const offset = tzOffsets[zone] ?? '+00:00';
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}:00${offset}`;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function expiryFromEndsAt(endsAt: string | null): { expiresInMs: number | null; status: ExpiryStatus } {
  if (!endsAt) {
    return { expiresInMs: null, status: 'unknown' };
  }
  const expiresInMs = new Date(endsAt).getTime() - Date.now();
  if (!Number.isFinite(expiresInMs)) {
    return { expiresInMs: null, status: 'unknown' };
  }
  if (expiresInMs <= 24 * 60 * 60 * 1000) {
    return { expiresInMs, status: 'urgent' };
  }
  if (expiresInMs <= 72 * 60 * 60 * 1000) {
    return { expiresInMs, status: 'warning' };
  }
  return { expiresInMs, status: 'safe' };
}

function inferClaimed(container: Element, progress: number): boolean {
  const text = container.textContent?.toLowerCase() ?? '';
  return (
    progress >= 100 ||
    text.includes('claimed') ||
    text.includes('claim now') ||
    text.includes('completed') ||
    container.querySelector('[data-test-selector*="claim"], button[aria-label*="Claim"]') !== null
  );
}

function inferGameNameForDrop(dropContainer: Element): string {
  const fromHeader = normalizeText(
    dropContainer.closest('section, article, [data-test-selector*="campaign"]')?.querySelector('h2, h3, h4')?.textContent
  );
  if (fromHeader) {
    return fromHeader;
  }

  const crumbs = Array.from(document.querySelectorAll('h1, h2, h3')).map((el) => normalizeText(el.textContent));
  return crumbs.find(Boolean) ?? 'Unknown Game';
}

function findCampaignHeader(block: Element): Element {
  const heading = Array.from(block.querySelectorAll('[role="heading"], .accordion-header')).find((node) =>
    node.querySelector('button[aria-expanded]')
  );
  return heading ?? block;
}

function extractCampaignId(block: Element): string {
  const href = (block.querySelector('a[href*="/drops/campaigns/"]') as HTMLAnchorElement | null)?.getAttribute('href') ?? '';
  const match = href.match(/\/drops\/campaigns\/([^/?#]+)/);
  if (match?.[1]) {
    return match[1];
  }
  return '';
}

function extractCampaignDateText(header: Element, block: Element): string {
  const fromHeader = Array.from(header.querySelectorAll('p, span, div'))
    .map((node) => normalizeText(node.textContent))
    .find((text) => isLikelyDateRangeText(text));
  if (fromHeader) {
    return fromHeader;
  }

  const fromBlock = Array.from(block.querySelectorAll('p, span, div'))
    .map((node) => normalizeText(node.textContent))
    .find((text) => isLikelyDateRangeText(text));
  return fromBlock ?? '';
}

function extractCampaignName(header: Element, block: Element): string {
  const imageAlt = normalizeText((header.querySelector('img[alt]') as HTMLImageElement | null)?.getAttribute('alt'));
  if (imageAlt) {
    return imageAlt;
  }

  const ignored = new Set(['summary', 'rewards', 'watch to redeem']);
  const candidates = Array.from(header.querySelectorAll('p, h2, h3, h4, strong, span, a'))
    .map((node) => normalizeText(node.textContent))
    .filter((text) => text.length > 1 && !ignored.has(text.toLowerCase()) && !isLikelyDateRangeText(text));
  if (candidates.length > 0) {
    return candidates[0];
  }

  return inferGameNameForDrop(block);
}

function extractCampaignMeta(block: Element, index: number) {
  const header = findCampaignHeader(block);
  const gameName = extractCampaignName(header, block);
  const dateText = extractCampaignDateText(header, block);
  const endsAt = parseEndsAt(header) ?? parseEndsAt(block) ?? parseEndDateFromRangeText(dateText);
  const { expiresInMs, status } = expiryFromEndsAt(endsAt);
  const campaignId = extractCampaignId(block);
  const categorySlug = extractCategorySlugFromHref(
    (block.querySelector('a[href*="/directory/category/"]') as HTMLAnchorElement | null)?.getAttribute('href') ?? ''
  );
  const imageUrl = getImageUrl((header.querySelector('img') as HTMLImageElement | null) ?? (block.querySelector('img') as HTMLImageElement | null));
  const gameId = campaignId ? `campaign-${campaignId}` : `campaign-${toId(gameName)}-${toId(dateText) || index}`;

  return {
    gameId,
    gameName,
    campaignId,
    categorySlug,
    endsAt,
    expiresInMs,
    expiryStatus: status,
    imageUrl,
    dateText,
  };
}

function extractCampaignBlocksForGames(): Element[] {
  const blocks = new Set<Element>();

  getAccordionButtons().forEach((button) => {
    const header = getAccordionHeader(button);
    if (!header) {
      return;
    }
    const parent = header.parentElement ?? header;
    const root = countAccordionButtons(parent) <= 1 ? parent : header;
    blocks.add(root);
  });

  const headings = Array.from(document.querySelectorAll('[role="heading"], .accordion-header'));
  headings.forEach((heading) => {
    if (!(heading instanceof Element)) {
      return;
    }
    if (!heading.querySelector('button[aria-expanded]')) {
      return;
    }
    const parent = heading.parentElement ?? heading;
    const root = countAccordionButtons(parent) <= 1 ? parent : heading;
    blocks.add(root);
  });

  if (blocks.size === 0) {
    const fallback = Array.from(
      document.querySelectorAll('.iSIERH, [data-test-selector="DropsCampaignInProgressDescription"], [data-test-selector="campaign-card"]')
    );
    fallback.forEach((node) => {
      if (node instanceof Element) {
        blocks.add(node);
      }
    });
  }

  return Array.from(blocks);
}

function extractCampaignCards(): TwitchGame[] {
  const gamesById = new Map<string, TwitchGame>();
  const campaignBlocks = extractCampaignBlocksForGames();

  campaignBlocks.forEach((block, index) => {
    const campaign = extractCampaignMeta(block, index);
    if (!campaign.gameName) {
      return;
    }
    if (campaign.expiresInMs !== null && campaign.expiresInMs <= 0) {
      return;
    }

    const existing = gamesById.get(campaign.gameId);
    gamesById.set(campaign.gameId, {
      id: campaign.gameId,
      name: campaign.gameName,
      imageUrl: campaign.imageUrl || existing?.imageUrl || '',
      categorySlug: campaign.categorySlug || existing?.categorySlug,
      campaignId: campaign.campaignId || existing?.campaignId,
      endsAt: campaign.endsAt ?? existing?.endsAt ?? null,
      expiresInMs: campaign.expiresInMs ?? existing?.expiresInMs ?? null,
      expiryStatus: campaign.expiryStatus !== 'unknown' ? campaign.expiryStatus : existing?.expiryStatus ?? 'unknown',
      dropCount: existing?.dropCount ?? 0,
    });
  });

  return Array.from(gamesById.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function isNoiseRewardName(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return true;
  }

  const blockedExact = new Set([
    'rewards',
    'watch to redeem',
    'how to earn the drop',
    'progress & redemption',
    'connection',
    '(required)',
    'required',
    'about this drop',
    'connect',
  ]);
  if (blockedExact.has(normalized)) {
    return true;
  }

  if (normalized.includes('watch to redeem') || normalized.startsWith('watch for ')) {
    return true;
  }
  if (normalized.includes('participating live channel') || normalized.includes('drops inventory')) {
    return true;
  }

  if (/\d{1,2}\s+[a-z]{3},\s+\d{1,2}:\d{2}/i.test(normalized) || /\b(?:cet|cest|utc|gmt|pst|pdt|est|edt)\b/.test(normalized)) {
    return true;
  }

  return false;
}

function countRewardAssetImages(scope: Element): number {
  return Array.from(scope.querySelectorAll('img')).filter(
    (node) => node instanceof HTMLImageElement && isRewardAssetUrl(getImageUrl(node))
  ).length;
}

function findRewardScopes(block: Element): Element[] {
  const scopes = new Set<Element>();
  const labels = Array.from(block.querySelectorAll('strong, p, h3, h4, span')).filter(
    (node) => normalizeForCompare(node.textContent ?? '') === 'rewards'
  );

  labels.forEach((label) => {
    let current: Element | null = label;
    while (current && current !== block) {
      if (countRewardAssetImages(current) > 0) {
        scopes.add(current);
        return;
      }
      current = current.parentElement;
    }
  });

  return scopes.size > 0 ? Array.from(scopes) : [block];
}

function findRewardCardContainer(image: HTMLImageElement, stopAt: Element): Element {
  let current: Element | null = image;
  let best: Element | null = image.parentElement;

  while (current && current !== stopAt) {
    const rewardImageCount = countRewardAssetImages(current);
    if (rewardImageCount === 1) {
      best = current;
      const textLength = normalizeText(current.textContent).length;
      if (textLength > 0 && textLength < 220) {
        return current;
      }
    }
    current = current.parentElement;
  }

  return best ?? stopAt;
}

function pickCampaignRewardName(card: Element, image: HTMLImageElement): string {
  const alt = normalizeText(image.getAttribute('alt'));
  if (alt && !isNoiseRewardName(alt)) {
    return alt;
  }

  const candidates = Array.from(card.querySelectorAll('p, strong, span, h3, h4, a'))
    .map((node) => normalizeText(node.textContent))
    .filter((text) => text.length > 2 && text.length < 140)
    .filter((text) => !isLikelyDateRangeText(text))
    .filter((text) => !isNoiseRewardName(text));

  if (candidates.length > 0) {
    return candidates[0];
  }

  return alt;
}

function parseRewardCardsFromCampaignBlock(block: Element): Array<{
  name: string;
  imageUrl: string;
  progress: number;
  claimed: boolean;
  claimable: boolean;
  requiredMinutes: number | null;
  remainingMinutes: number | null;
  progressSource: 'campaign';
}> {
  const parsedByKey = new Map<
    string,
    {
      name: string;
      imageUrl: string;
      progress: number;
      claimed: boolean;
      claimable: boolean;
      requiredMinutes: number | null;
      remainingMinutes: number | null;
      progressSource: 'campaign';
    }
  >();
  const scopes = findRewardScopes(block);

  scopes.forEach((scope, scopeIndex) => {
    const rewardImages = Array.from(scope.querySelectorAll('img')).filter(
      (node): node is HTMLImageElement => node instanceof HTMLImageElement && isRewardAssetUrl(getImageUrl(node))
    );

    rewardImages.forEach((image, imageIndex) => {
      const imageUrl = getImageUrl(image);
      if (!imageUrl) {
        return;
      }

      const card = findRewardCardContainer(image, scope);
      const name = pickCampaignRewardName(card, image);
      if (isNoiseRewardName(name)) {
        return;
      }

      const progress = parseProgress(card);
      const cardText = normalizeText(card.textContent).toLowerCase();
      const claimButton = Array.from(card.querySelectorAll('button')).find(
        (button) => normalizeForCompare(button.textContent ?? '').includes('claim') && !button.hasAttribute('disabled')
      );
      const claimable = Boolean(claimButton) || cardText.includes('claim now');
      const claimed = inferClaimed(card, progress);
      const key = `${toId(name)}::${toId(imageUrl) || `${scopeIndex}-${imageIndex}`}`;
      const existing = parsedByKey.get(key);
      const next = {
        name,
        imageUrl,
        progress: existing ? Math.max(existing.progress, progress) : progress,
        claimed: Boolean(existing?.claimed) || claimed,
        claimable: Boolean(existing?.claimable) || claimable,
        requiredMinutes: null,
        remainingMinutes: null,
        progressSource: 'campaign' as const,
      };
      parsedByKey.set(key, next);
    });
  });

  return Array.from(parsedByKey.values());
}

function extractDropsInfo(): TwitchDrop[] {
  const campaignBlocks = extractCampaignBlocks();
  const drops: TwitchDrop[] = [];

  campaignBlocks.forEach((block, blockIndex) => {
    const campaign = extractCampaignMeta(block, blockIndex);
    if (!campaign.gameName) {
      return;
    }

    const rewardCards = parseRewardCardsFromCampaignBlock(block);
    rewardCards.forEach((reward, rewardIndex) => {
      drops.push({
        id: `${campaign.gameId}-${toId(reward.name)}-${toId(reward.imageUrl) || rewardIndex}`,
        name: reward.name,
        gameId: campaign.gameId,
        gameName: campaign.gameName,
        imageUrl: reward.imageUrl,
        categorySlug: campaign.categorySlug || undefined,
        progress: reward.progress,
        claimed: reward.claimed,
        claimable: reward.claimable,
        campaignId: campaign.campaignId || undefined,
        endsAt: campaign.endsAt,
        expiresInMs: campaign.expiresInMs,
        status: reward.claimed ? 'completed' : reward.progress > 0 ? 'active' : 'pending',
        requiredMinutes: reward.requiredMinutes,
        remainingMinutes: reward.remainingMinutes,
        progressSource: reward.progressSource,
      });
    });
  });

  const unique = new Map<string, TwitchDrop>();
  drops.forEach((drop) => {
    const key = `${drop.gameId}::${toId(drop.name)}::${toId(drop.imageUrl)}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, drop);
      return;
    }
    unique.set(key, {
      ...existing,
      progress: Math.max(existing.progress, drop.progress),
      claimed: existing.claimed || drop.claimed,
      claimable: existing.claimable || drop.claimable,
      imageUrl: existing.imageUrl || drop.imageUrl,
      requiredMinutes: existing.requiredMinutes ?? drop.requiredMinutes ?? null,
      remainingMinutes: existing.remainingMinutes ?? drop.remainingMinutes ?? null,
      progressSource: existing.progressSource ?? drop.progressSource,
    });
  });

  return Array.from(unique.values());
}

function pickRewardName(node: Element): string {
  const candidates = Array.from(node.querySelectorAll('p, h3, h4, strong, span'))
    .map((el) => normalizeText(el.textContent))
    .filter((text) => text.length > 2 && text.length < 120);

  const blocked = [
    'drops inventory',
    'progress',
    'claim',
    'watch',
    'minutes',
    'redeem',
    'campaign',
    'connection',
    'about this drop',
  ];

  return (
    candidates.find((value) => {
      const lower = value.toLowerCase();
      return !blocked.some((token) => lower.includes(token)) && !/\d+\s*%/.test(lower);
    }) ?? ''
  );
}

function extractBoxartToken(url: string): string {
  const match = url.match(/ttv-boxart\/([^/?]+)/);
  if (!match) {
    return '';
  }
  return match[1].split('-')[0];
}

function findAwardedDropButton(scope: Element): HTMLButtonElement | null {
  const buttons = Array.from(scope.querySelectorAll('button'));
  const found = buttons.find((button) => normalizeForCompare(button.getAttribute('aria-label') ?? '').includes('awarded drop'));
  return (found as HTMLButtonElement | undefined) ?? null;
}

function extractClaimedInventoryDrops(): TwitchDrop[] {
  const awardedButtons = Array.from(document.querySelectorAll('button')).filter((button) =>
    normalizeForCompare(button.getAttribute('aria-label') ?? '').includes('awarded drop')
  );
  const claimed: TwitchDrop[] = [];

  awardedButtons.forEach((button, index) => {
    let card: Element | null = button;
    while (card && card !== document.body) {
      const hasRewardImage = Boolean(card.querySelector('img.inventory-drop-image, img[src*="/REWARD/"]'));
      const nameText = normalizeText(card.querySelector('p.kGfRxP, p.JNNiZ, p[class*="CoreText"]')?.textContent);
      if (hasRewardImage && nameText) {
        break;
      }
      card = card.parentElement;
    }

    if (!card || card === document.body) {
      return;
    }

    const name = normalizeText(card.querySelector('p.kGfRxP, p.JNNiZ, p[class*="CoreText"]')?.textContent);
    if (!name || isNoiseRewardName(name)) {
      return;
    }
    const imageUrl = getImageUrl(card.querySelector('img.inventory-drop-image, img[src*="/REWARD/"]') as HTMLImageElement | null);
    if (!imageUrl) {
      return;
    }

    claimed.push({
      id: `inventory-claimed-${toId(name)}-${index}`,
      name,
      gameId: 'inventory-claimed',
      gameName: '',
      imageUrl,
      progress: 100,
      claimed: true,
      claimable: false,
      status: 'completed',
      requiredMinutes: 0,
      remainingMinutes: 0,
      progressSource: 'inventory',
    });
  });

  const unique = new Map<string, TwitchDrop>();
  claimed.forEach((drop) => {
    const key = `${toId(drop.name)}::${toId(drop.imageUrl)}`;
    if (!unique.has(key)) {
      unique.set(key, drop);
    }
  });
  return Array.from(unique.values());
}

function extractInventoryDrops(selectedGameName?: string, selectedGameImage?: string): TwitchDrop[] {
  if (!window.location.pathname.includes(INVENTORY_PATH)) {
    return [];
  }

  const selectedNameNorm = normalizeForCompare(selectedGameName ?? '');
  const selectedBoxart = extractBoxartToken(selectedGameImage ?? '');
  const campaigns = Array.from(document.querySelectorAll('.jtROCr'));
  const drops: TwitchDrop[] = [];

  campaigns.forEach((campaign, campaignIndex) => {
    const campaignTitle = normalizeText(
      campaign.querySelector('.inventory-campaign-info p.etlgoc, .inventory-campaign-info a, .inventory-campaign-info p')?.textContent
    );
    const campaignTextNorm = normalizeForCompare(campaign.textContent ?? '');
    const campaignBoxart = extractBoxartToken(
      (campaign.querySelector('.inventory-boxart, [data-test-selector="DropsCampaignInProgressDescription-game-card-image"]') as HTMLImageElement | null)
        ?.src ?? ''
    );
    const campaignMatches =
      (!selectedNameNorm && !selectedBoxart) ||
      (selectedNameNorm && (normalizeForCompare(campaignTitle).includes(selectedNameNorm) || campaignTextNorm.includes(selectedNameNorm))) ||
      (selectedBoxart && campaignBoxart === selectedBoxart);

    if (!campaignMatches) {
      return;
    }

    const campaignHref = (campaign.querySelector('.inventory-campaign-info a[href*="/drops/campaigns"]') as HTMLAnchorElement | null)?.getAttribute('href') ?? '';
    const dropId = campaignHref.match(/[?&]dropID=([^&]+)/)?.[1] ?? '';
    const campaignGameName = selectedGameName || campaignTitle || 'Unknown Game';
    const gameId = dropId ? `inventory-${dropId}` : `campaign-${toId(campaignGameName)}`;

    const rewardCards = Array.from(campaign.querySelectorAll('.dMMIGt .enzXXt'));
    rewardCards.forEach((card, rewardIndex) => {
      const name = normalizeText(card.querySelector('p.kGfRxP, p.JNNiZ, p[class*="CoreText"]')?.textContent) || pickRewardName(card);
      if (!name) {
        return;
      }

      const lower = normalizeText(card.textContent).toLowerCase();
      const rawProgress = parseProgress(card);
      const claimButton = Array.from(card.querySelectorAll('button')).find(
        (button) => normalizeForCompare(button.textContent ?? '').includes('claim') && !button.hasAttribute('disabled')
      );
      const awardedButton = findAwardedDropButton(card);
      const claimedByText =
        lower.includes('claimed') || lower.includes('collected') || lower.includes('reward is no longer available') || lower.includes('awarded');
      const claimed = claimedByText || Boolean(awardedButton) || (rawProgress >= 100 && !claimButton && !lower.includes('claim now'));
      const claimable = !claimed && (Boolean(claimButton) || lower.includes('claim now'));
      const progress = claimed || claimable ? 100 : rawProgress;
      const requiredMinutes = parseRequiredMinutesFromText(card.textContent ?? '');
      const remainingMinutes = computeRemainingMinutes(progress, requiredMinutes, claimed || claimable);
      const imageUrl = getImageUrl(card.querySelector('img') as HTMLImageElement | null);

      drops.push({
        id: `inventory-${gameId}-${toId(name)}-${campaignIndex}-${rewardIndex}`,
        name,
        gameId,
        gameName: campaignGameName,
        imageUrl,
        progress,
        claimed,
        claimable,
        campaignId: dropId || undefined,
        status: claimed ? 'completed' : claimable ? 'pending' : progress > 0 ? 'active' : 'pending',
        requiredMinutes,
        remainingMinutes,
        progressSource: 'inventory',
      });
    });
  });

  drops.push(...extractClaimedInventoryDrops());

  const unique = new Map<string, TwitchDrop>();
  drops.forEach((drop) => {
    const key = `${toId(drop.gameName)}::${toId(drop.name)}::${toId(drop.imageUrl)}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, drop);
      return;
    }
    unique.set(key, {
      ...existing,
      progress: drop.progressSource === 'inventory' ? drop.progress : Math.max(existing.progress, drop.progress),
      claimed: existing.claimed || drop.claimed,
      claimable: existing.claimable || drop.claimable,
      imageUrl: existing.imageUrl || drop.imageUrl,
      requiredMinutes: drop.requiredMinutes ?? existing.requiredMinutes ?? null,
      remainingMinutes: drop.remainingMinutes ?? existing.remainingMinutes ?? null,
      progressSource: drop.progressSource ?? existing.progressSource,
    });
  });

  return Array.from(unique.values());
}

function syncSnapshot(): DropsSnapshot {
  let games: TwitchGame[] = [];
  let drops: TwitchDrop[] = [];
  try {
    games = extractCampaignCards();
    drops = extractDropsInfo();
  } catch (error) {
    console.error('DropHunter snapshot extraction failed:', error);
  }

  const dropsByGame = new Map<string, number>();
  drops.forEach((drop) => {
    dropsByGame.set(drop.gameId, (dropsByGame.get(drop.gameId) ?? 0) + 1);
  });

  const hydratedGames = games.map((game) => ({
    ...game,
    dropCount: dropsByGame.get(game.id) ?? game.dropCount ?? 0,
  }));

  return {
    games: hydratedGames,
    drops,
    updatedAt: Date.now(),
  };
}

function parseViewerCount(text: string): number | null {
  const normalized = normalizeText(text).toLowerCase();
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*([km])?/);
  if (!match) {
    return null;
  }
  const num = Number.parseFloat(match[1].replace(',', '.'));
  if (Number.isNaN(num)) {
    return null;
  }
  const suffix = match[2];
  if (suffix === 'k') {
    return Math.round(num * 1_000);
  }
  if (suffix === 'm') {
    return Math.round(num * 1_000_000);
  }
  return Math.round(num);
}

function streamTitleHasDrops(value: string): boolean {
  return /\bdrops\b/i.test(normalizeText(value));
}

function extractDirectoryCardTitle(card: Element): string {
  const titleNode = card.querySelector(
    'a[data-test-selector="TitleAndChannel"] h4, a[data-test-selector="TitleAndChannel"] h3, h4[title], h3[title], [data-a-target="preview-card-title"], [data-test-selector*="preview-card-title"]'
  );
  const directTitle = normalizeText(titleNode?.getAttribute('title')) || normalizeText(titleNode?.textContent);
  if (directTitle) {
    return directTitle;
  }

  const channelLink = card.querySelector('a[data-test-selector="TitleAndChannel"][aria-label]') as HTMLAnchorElement | null;
  const ariaLabel = normalizeText(channelLink?.getAttribute('aria-label'));
  const ariaTitle = ariaLabel.match(/\bstreaming\b\s+(.+)$/i)?.[1] ?? '';
  return normalizeText(ariaTitle);
}

function extractDirectoryStreamers() {
  const cards = Array.from(document.querySelectorAll('article, [data-target="directory-page__card"], [data-a-target="preview-card-image-link"]'));
  const strictTitleCandidates: Array<{
    id: string;
    name: string;
    displayName: string;
    isLive: true;
    viewerCount: number;
    thumbnailUrl?: string;
  }> = [];

  cards.forEach((card) => {
    const root = (card.closest('article, [data-target="directory-page__card"]') as Element | null) ?? card;
    const anchor =
      (root.querySelector(
        'a[data-a-target="preview-card-channel-link"], a[data-a-target="preview-card-image-link"], a[data-test-selector="TitleAndChannel"], a[href^="/"]'
      ) as HTMLAnchorElement | null) ||
      (root.matches('a[href^="/"]') ? (root as HTMLAnchorElement) : null);
    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute('href') ?? '';
    const channel = href.split('/').filter(Boolean)[0];
    if (!channel || channel === 'directory' || channel === 'drops') {
      return;
    }

    const streamTitle = extractDirectoryCardTitle(root);
    if (!streamTitleHasDrops(streamTitle)) {
      return;
    }

    const viewersText =
      normalizeText(root.querySelector('[data-a-target="animated-channel-viewers-count"], [class*="viewer"]')?.textContent) ||
      normalizeText(root.textContent);
    const viewerCount = parseViewerCount(viewersText) ?? Number.MAX_SAFE_INTEGER;
    const candidate = {
      id: channel.toLowerCase(),
      name: channel.toLowerCase(),
      displayName: channel,
      isLive: true as const,
      viewerCount,
      thumbnailUrl: (root.querySelector('img') as HTMLImageElement | null)?.src,
    };
    strictTitleCandidates.push(candidate);
  });

  const sortAndUnique = (input: Array<{
    id: string;
    name: string;
    displayName: string;
    isLive: true;
    viewerCount: number;
    thumbnailUrl?: string;
  }>) => {
    const byChannel = new Map<string, (typeof input)[number]>();
    input.forEach((streamer) => {
      const existing = byChannel.get(streamer.name);
      if (!existing || streamer.viewerCount < existing.viewerCount) {
        byChannel.set(streamer.name, streamer);
      }
    });
    return Array.from(byChannel.values()).sort((a, b) => a.viewerCount - b.viewerCount).slice(0, 25);
  };

  return sortAndUnique(strictTitleCandidates);
}

function extractChannelNameFromPath(): string | null {
  if (window.location.hostname === 'player.twitch.tv') {
    const fromQuery = normalizeText(new URL(window.location.href).searchParams.get('channel'));
    if (fromQuery) {
      return fromQuery.toLowerCase();
    }
  }

  const segment = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
  const reserved = new Set([
    'directory',
    'drops',
    'settings',
    'subscriptions',
    'wallet',
    'privacy',
    'inventory',
    'search',
    'videos',
    'downloads',
    'turbo',
    'jobs',
    'p',
    'store',
  ]);
  if (!segment || reserved.has(segment.toLowerCase())) {
    return null;
  }
  return segment.toLowerCase();
}

function extractStreamCategory(): { slug: string; label: string } {
  const links = Array.from(
    document.querySelectorAll('a[data-a-target="stream-game-link"], a[href*="/directory/category/"]')
  ) as HTMLAnchorElement[];
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    const slug = extractCategorySlugFromHref(href);
    if (!slug) {
      continue;
    }
    const label = normalizeText(link.textContent) || slug.replace(/-/g, ' ');
    return { slug, label };
  }
  return { slug: '', label: '' };
}

function extractStreamTitleText(): string {
  const titleNode = document.querySelector('[data-a-target="stream-title"], h2[data-a-target="stream-title"], h1[data-a-target="stream-title"], h1');
  const fromNode = normalizeText(titleNode?.textContent);
  if (fromNode) {
    return fromNode;
  }
  return normalizeText(document.title.replace(/\s*-\s*Twitch.*$/i, ''));
}

function hasDropsInStreamScope(streamTitle: string): boolean {
  const titleNorm = normalizeForCompare(streamTitle);
  if (/\bdrops?\b/.test(titleNorm)) {
    return true;
  }
  const docTitleNorm = normalizeForCompare(document.title);
  if (/\bdrops?\b/.test(docTitleNorm)) {
    return true;
  }

  const titleNode = document.querySelector('[data-a-target="stream-title"], h2[data-a-target="stream-title"], h1');
  const scope = titleNode?.closest('main, article, section, div') ?? document.body;
  const explicit = scope.querySelector(
    '[data-test-selector*="drops" i], [data-a-target*="drops" i], [aria-label*="drops" i], [title*="drops" i], a[href*="filter=drops"]'
  );
  if (explicit) {
    return true;
  }

  const tokens = Array.from(scope.querySelectorAll('a, span, p, button'))
    .map((node) => normalizeForCompare(node.textContent ?? ''))
    .filter((text) => text.length > 0 && text.length <= 64);
  return tokens.some((token) => token === 'drops' || token === 'drops enabled' || token.includes('drops enabled'));
}

function detectStreamLiveStatus(): boolean {
  const hasVideo = document.querySelector('video') !== null;
  if (!hasVideo) {
    return false;
  }
  const pageText = normalizeForCompare(document.body?.textContent ?? '');
  if (pageText.includes('this channel is offline') || pageText.includes('channel is offline')) {
    return false;
  }
  return true;
}

function extractStreamContext() {
  const channelName = extractChannelNameFromPath();
  if (!channelName) {
    return null;
  }

  const category = extractStreamCategory();
  const streamTitle = extractStreamTitleText();
  const titleContainsDrops = /\bdrops?\b/i.test(streamTitle) || /\bdrops?\b/i.test(document.title);
  const hasDropsSignal = hasDropsInStreamScope(streamTitle);
  const isLive = detectStreamLiveStatus();

  return {
    channelName,
    categorySlug: category.slug,
    categoryLabel: category.label,
    streamTitle,
    titleContainsDrops,
    hasDropsSignal,
    isLive,
    pageUrl: window.location.href,
  };
}

function extractCategorySuggestions() {
  const links = Array.from(document.querySelectorAll('a[href*="/directory/category/"]'));
  const bySlug = new Map<string, { slug: string; label: string }>();

  links.forEach((link) => {
    const href = (link as HTMLAnchorElement).getAttribute('href') ?? '';
    const slug = extractCategorySlugFromHref(href);
    if (!slug) {
      return;
    }
    const label =
      normalizeText(link.querySelector('img')?.getAttribute('alt')) ||
      normalizeText(link.textContent) ||
      slug.replace(/-/g, ' ');
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { slug, label });
    }
  });

  return Array.from(bySlug.values());
}

function prepareStreamPlayback() {
  const channelName = extractChannelNameFromPath();
  if (!channelName) {
    return { played: false, unmuted: false, volumeAdjusted: false, clickedSurface: false, isAudioReady: false };
  }

  let played = false;
  let unmuted = false;
  let volumeAdjusted = false;
  let clickedSurface = false;

  const clickElement = (element: Element | null | undefined) => {
    if (!element) {
      return;
    }
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    element.dispatchEvent(mouseDown);
    element.dispatchEvent(mouseUp);
    element.dispatchEvent(click);
    clickedSurface = true;
  };

  const playerSurface =
    (document.querySelector('[data-a-target="video-player"]') as HTMLElement | null) ||
    (document.querySelector('[data-a-player-state]') as HTMLElement | null) ||
    (document.querySelector('div[data-test-selector*="video-player"]') as HTMLElement | null);
  clickElement(playerSurface);

  const playPauseButton = document.querySelector('[data-a-target="player-play-pause-button"]') as HTMLButtonElement | null;
  if (playPauseButton) {
    const label = normalizeForCompare(playPauseButton.getAttribute('aria-label') ?? playPauseButton.textContent ?? '');
    if (label.includes('play')) {
      playPauseButton.click();
      played = true;
    }
  }

  const muteButton = document.querySelector('[data-a-target="player-mute-unmute-button"]') as HTMLButtonElement | null;
  if (muteButton) {
    const label = normalizeForCompare(muteButton.getAttribute('aria-label') ?? muteButton.textContent ?? '');
    if (label.includes('unmute')) {
      muteButton.click();
      unmuted = true;
    }
  }

  const overlayUnmuteButton = document.querySelector('[data-a-target="player-overlay-mute-unmute-button"]') as HTMLButtonElement | null;
  if (overlayUnmuteButton) {
    const label = normalizeForCompare(overlayUnmuteButton.getAttribute('aria-label') ?? overlayUnmuteButton.textContent ?? '');
    if (label.includes('unmute')) {
      overlayUnmuteButton.click();
      unmuted = true;
    }
  }

  const volumeSlider = document.querySelector('input[data-a-target="player-volume-slider"]') as HTMLInputElement | null;
  if (volumeSlider) {
    const currentValue = Number.parseFloat(volumeSlider.value || '0');
    if (!Number.isFinite(currentValue) || currentValue <= 0.01) {
      volumeSlider.value = '0.35';
      volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
      volumeSlider.dispatchEvent(new Event('change', { bubbles: true }));
      volumeAdjusted = true;
    }
  }

  const video = document.querySelector('video') as HTMLVideoElement | null;
  if (video) {
    clickElement(video);
    if (video.muted) {
      video.muted = false;
      unmuted = true;
    }
    if (video.volume <= 0.01) {
      video.volume = 0.35;
      volumeAdjusted = true;
    }
    if (video.paused) {
      video.play().catch(() => undefined);
      played = true;
    }
  }

  const isAudioReady = Boolean(video && !video.paused && !video.muted && video.volume > 0.01);
  return { played, unmuted, volumeAdjusted, clickedSurface, isAudioReady };
}

function getCookieValue(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function parseTwilightUserEntry(): { oauthToken: string; userId: string } {
  const keys = ['twilight-user', 'twilight-user-data', 'twilight-user-data-v2', '__twilight-user', 'twilight-session'];
  const stores: Storage[] = [window.localStorage, window.sessionStorage];
  for (const store of stores) {
    for (const key of keys) {
      const raw = store.getItem(key);
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const asText = (value: unknown): string => (typeof value === 'string' ? normalizeText(value) : '');
        const parsedUser = parsed.user && typeof parsed.user === 'object' ? (parsed.user as Record<string, unknown>) : null;
        const oauthToken = asText(parsed.authToken) || asText(parsed.token) || asText(parsed.accessToken) || asText(parsed.oauthToken);
        const userId =
          asText(parsed.userID) ||
          asText(parsed.userId) ||
          asText(parsed.id) ||
          asText(parsedUser?.id);
        if (oauthToken || userId) {
          return { oauthToken, userId };
        }
      } catch {
        // Ignore malformed entries.
      }
    }
  }
  return { oauthToken: '', userId: '' };
}

function createSessionUuid(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(random, (value) => value.toString(16).padStart(2, '0')).join('');
}

function extractTwitchSession() {
  const twilight = parseTwilightUserEntry();
  const oauthToken =
    twilight.oauthToken ||
    normalizeText(getCookieValue('auth-token')) ||
    normalizeText(getCookieValue('__Secure-auth-token'));
  const userId = twilight.userId;
  const deviceId =
    normalizeText(window.localStorage.getItem('local_copy_unique_id')) ||
    normalizeText(window.localStorage.getItem('device_id')) ||
    normalizeText(window.localStorage.getItem('deviceId')) ||
    normalizeText(window.sessionStorage.getItem('local_copy_unique_id')) ||
    normalizeText(window.sessionStorage.getItem('device_id')) ||
    normalizeText(window.sessionStorage.getItem('deviceId')) ||
    normalizeText(getCookieValue('unique_id')) ||
    normalizeText(getCookieValue('__Secure-unique_id')) ||
    normalizeText(getCookieValue('device_id'));
  const uuid =
    normalizeText(window.localStorage.getItem('client-session-id')) ||
    normalizeText(window.localStorage.getItem('clientSessionId')) ||
    normalizeText(window.sessionStorage.getItem('client-session-id')) ||
    normalizeText(window.sessionStorage.getItem('clientSessionId')) ||
    createSessionUuid();
  const clientIntegrity =
    normalizeText(window.localStorage.getItem('client-integrity')) ||
    normalizeText(window.localStorage.getItem('clientIntegrity'));

  if (!oauthToken || !deviceId) {
    console.warn(LOG_PREFIX, 'Content session extraction failed', {
      hasOAuthToken: Boolean(oauthToken),
      hasUserId: Boolean(userId),
      hasDeviceId: Boolean(deviceId),
      hasClientIntegrity: Boolean(clientIntegrity),
      hasCookieAuthToken: Boolean(normalizeText(getCookieValue('auth-token'))),
      hasCookieUniqueId: Boolean(normalizeText(getCookieValue('unique_id')) || normalizeText(getCookieValue('device_id'))),
    });
    return null;
  }

  console.info(LOG_PREFIX, 'Content session extracted', {
    userId,
    oauthTokenLength: oauthToken.length,
    hasClientIntegrity: Boolean(clientIntegrity),
    deviceIdSuffix: deviceId.slice(-6),
    uuid,
  });

  return {
    oauthToken,
    userId: userId || '',
    deviceId,
    uuid,
    clientIntegrity: clientIntegrity || undefined,
  };
}

function syncTwitchSessionToBackground() {
  const session = extractTwitchSession();
  if (!session) {
    return;
  }
  chrome.runtime
    .sendMessage({
      type: 'SYNC_TWITCH_SESSION',
      payload: { session },
    })
    .catch(() => undefined);
}

function showToast(message: string) {
  const id = 'drophunter-toast';
  const existing = document.getElementById(id);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = id;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    maxWidth: '360px',
    background: 'rgba(20, 20, 25, 0.95)',
    color: '#fff',
    border: '1px solid rgba(145, 70, 255, 0.7)',
    borderRadius: '12px',
    padding: '12px 14px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    fontSize: '13px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
  });

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5500);
}

function playBeep(kind: 'drop-complete' | 'all-complete') {
  try {
    const AudioCtx = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return;
    }
    const ctx = new AudioCtx();
    const sequence = kind === 'all-complete' ? [680, 860, 1020] : [740, 980];

    sequence.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.value = 0.0001;

      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = ctx.currentTime + index * 0.18;
      const end = start + 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.start(start);
      osc.stop(end);
    });
  } catch (error) {
    console.error('Unable to play audio cue:', error);
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'FETCH_GAMES': {
      const snapshot = syncSnapshot();
      chrome.runtime.sendMessage({ type: 'SYNC_DROPS_DATA', payload: snapshot }).catch(() => undefined);
      sendResponse({ success: true, games: snapshot.games });
      break;
    }
    case 'FETCH_DROPS_DATA': {
      const selectedGameName = normalizeText(message.payload?.selectedGameName);
      ensureAccordionExpanded(selectedGameName, true)
        .then(() => {
          sendResponse({ success: true, snapshot: syncSnapshot() });
        })
        .catch(() => {
          sendResponse({ success: true, snapshot: syncSnapshot() });
        });
      return true;
    }
    case 'GET_DROPS_DATA': {
      const selectedGameName = normalizeText(message.payload?.selectedGameName);
      ensureAccordionExpanded(selectedGameName)
        .then(() => {
          sendResponse({ success: true, drops: extractDropsInfo() });
        })
        .catch(() => {
          sendResponse({ success: true, drops: extractDropsInfo() });
        });
      return true;
    }
    case 'FETCH_INVENTORY_DATA': {
      const selectedGameName = normalizeText(message.payload?.selectedGameName);
      const selectedGameImage = normalizeText(message.payload?.selectedGameImage);
      sendResponse({ success: true, drops: extractInventoryDrops(selectedGameName, selectedGameImage) });
      return true;
    }
    case 'EXPAND_GAME_ACCORDION': {
      const selectedGameName = normalizeText(message.payload?.selectedGameName);
      ensureAccordionExpanded(selectedGameName, false)
        .then((expanded) => {
          sendResponse({ success: true, expanded });
        })
        .catch(() => {
          sendResponse({ success: false, expanded: false });
        });
      return true;
    }
    case 'GET_DIRECTORY_STREAMERS': {
      sendResponse({ success: true, streamers: extractDirectoryStreamers() });
      break;
    }
    case 'GET_TWITCH_SESSION': {
      const session = extractTwitchSession();
      sendResponse({ success: Boolean(session), session });
      break;
    }
    case 'GET_STREAM_CONTEXT': {
      sendResponse({ success: true, context: extractStreamContext() });
      break;
    }
    case 'GET_CATEGORY_SUGGESTIONS': {
      sendResponse({ success: true, categories: extractCategorySuggestions() });
      break;
    }
    case 'PREPARE_STREAM_PLAYBACK': {
      sendResponse({ success: true, ...prepareStreamPlayback() });
      break;
    }
    case 'PLAY_ALERT': {
      const payload = message.payload ?? {};
      const kind = payload.kind === 'all-complete' ? 'all-complete' : 'drop-complete';
      const text = normalizeText(payload.message) || (kind === 'all-complete' ? 'All drops completed.' : 'Drop completed.');
      playBeep(kind);
      showToast(text);
      sendResponse({ success: true });
      break;
    }
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true;
});

let syncTimer: number | null = null;

function scheduleAutoSync() {
  if (!window.location.pathname.includes(DROPS_PATH)) {
    return;
  }
  if (syncTimer) {
    window.clearTimeout(syncTimer);
  }
  syncTimer = window.setTimeout(() => {
    const snapshot = syncSnapshot();
    chrome.runtime.sendMessage({ type: 'SYNC_DROPS_DATA', payload: snapshot }).catch(() => undefined);
  }, 700);
}

if (window.location.href.includes('twitch.tv/drops') || window.location.href.includes('twitch.tv/directory')) {
  const observer = new MutationObserver(scheduleAutoSync);
  observer.observe(document.body, { childList: true, subtree: true });

  if (window.location.pathname.includes(DROPS_PATH)) {
    window.setTimeout(() => {
      const snapshot = syncSnapshot();
      chrome.runtime.sendMessage({ type: 'SYNC_DROPS_DATA', payload: snapshot }).catch(() => undefined);
    }, 1400);
  }

  if (window.location.pathname.includes('/directory/category/')) {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('tl')) {
      url.searchParams.set('tl', DROPS_TAG_ID);
      window.history.replaceState({}, '', url.toString());
    }
  }
}

// The integrity-interceptor.js (MAIN world, document_start) patches fetch
// to capture Twitch's integrity tokens and stores them in sessionStorage.
// We read from sessionStorage here and also listen for real-time updates.

const INTEGRITY_STORAGE_KEY = '__drophunter_integrity__';

function syncIntegrityToBackground(source: string) {
  try {
    const raw = window.sessionStorage.getItem(INTEGRITY_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const detail = JSON.parse(raw) as { token?: string; expiration?: number; request_id?: string };
    if (detail && typeof detail.token === 'string' && detail.token.length > 0) {
      console.info(LOG_PREFIX, `Integrity token from page (${source})`, {
        tokenLength: detail.token.length,
        expiration: detail.expiration,
      });
      chrome.runtime.sendMessage({
        type: 'SYNC_TWITCH_INTEGRITY',
        payload: detail,
      }).catch(() => undefined);
    }
  } catch {
    // Ignore parse errors
  }
}

// Listen for real-time integrity updates from the MAIN world interceptor
window.addEventListener(INTEGRITY_STORAGE_KEY, ((event: CustomEvent) => {
  try {
    const detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
    if (detail && typeof detail.token === 'string' && detail.token.length > 0) {
      console.info(LOG_PREFIX, 'Intercepted Twitch integrity token (live)', {
        tokenLength: detail.token.length,
        expiration: detail.expiration,
      });
      chrome.runtime.sendMessage({
        type: 'SYNC_TWITCH_INTEGRITY',
        payload: detail,
      }).catch(() => undefined);
    }
  } catch {
    // Ignore parse errors
  }
}) as EventListener);

// Read any integrity token that was already captured before this script loaded
syncIntegrityToBackground('sessionStorage');

window.setTimeout(() => {
  syncTwitchSessionToBackground();
  // Re-check sessionStorage in case integrity was fetched between page load
  // and content script initialization
  syncIntegrityToBackground('delayed-check');
}, 900);
