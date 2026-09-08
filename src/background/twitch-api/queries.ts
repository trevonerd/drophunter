export const CURRENT_USER_QUERY = {
  operationName: 'CoreActionsCurrentUser',
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: '6b5b63a013cf66a995d61f71a508ab5c8e4473350c5d4136f846ba65e8101e95',
    },
  },
};

export const VIEWER_DROPS_DASHBOARD_QUERY = {
  operationName: 'ViewerDropsDashboard',
  variables: { fetchRewardCampaigns: false },
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: '5a4da2ab3d5b47c9f9ce864e727b2cb346af1e3ea8b897fe8f704a97ff017619',
    },
  },
};

export const INVENTORY_QUERY = {
  operationName: 'Inventory',
  variables: { fetchRewardCampaigns: false },
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: 'd86775d0ef16a63a33ad52e80eaff963b2d5b72fada7c991504a57496e1d8e4b',
    },
  },
};

export const CLAIM_DROP_REWARD_QUERY = {
  operationName: 'DropsPage_ClaimDropRewards',
  variables: { input: { dropInstanceID: '' } },
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930',
    },
  },
};
