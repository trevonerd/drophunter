import { describe } from 'bun:test';
import { registerTablessFailureCases } from './cases/farming-session-transition-tabless-failure.ts';
import { registerTablessOwnershipCases } from './cases/farming-session-transition-tabless-ownership.ts';

describe('automatic farming session tabless transition', () => {
  registerTablessOwnershipCases();
  registerTablessFailureCases();
});
