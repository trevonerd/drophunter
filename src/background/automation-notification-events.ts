export const AUTOMATION_NOTIFICATION_EVENTS = [
  'discovery',
  'start',
  'preemption',
  'manual-suspended',
  'manual-resumed',
  'recovery',
  'exclusion',
  'completion',
  'sign-in-required',
  'unfarmable',
  'queue-cleanup',
] as const;

export type AutomationNotificationEvent = (typeof AUTOMATION_NOTIFICATION_EVENTS)[number];
