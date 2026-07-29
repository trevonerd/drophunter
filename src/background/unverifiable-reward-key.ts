export type UnverifiableRewardIdentity = {
  readonly campaignId: string;
  readonly rewardId: string;
};

export function encodeUnverifiableRewardKey(
  rewardIdInput: string,
  campaignIdInput: string | undefined,
): string | null {
  const rewardId = rewardIdInput.trim();
  const campaignId = campaignIdInput?.trim() ?? '';
  return rewardId.length > 0 && campaignId.length > 0 ? JSON.stringify([campaignId, rewardId]) : null;
}

export function parseUnverifiableRewardKey(key: string): UnverifiableRewardIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [campaignId, rewardId] = parsed;
  if (
    typeof campaignId !== 'string' ||
    typeof rewardId !== 'string' ||
    campaignId.length === 0 ||
    rewardId.length === 0 ||
    campaignId.trim() !== campaignId ||
    rewardId.trim() !== rewardId ||
    key !== JSON.stringify([campaignId, rewardId])
  ) {
    return null;
  }
  return { campaignId, rewardId };
}
