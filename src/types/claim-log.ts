export interface ClaimLogEntry {
  id: string;
  claimId?: string;
  dropId: string;
  dropName: string;
  benefitName?: string;
  gameId: string;
  gameName: string;
  campaignId?: string;
  campaignName?: string;
  campaignLabel: string;
  claimedAt: number;
  imageUrl?: string;
}
