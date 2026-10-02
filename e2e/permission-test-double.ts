import type { Worker } from '@playwright/test';

export interface PermissionCall {
  origins?: string[];
  permissions?: string[];
}

export async function installPermissionTestDouble(worker: Worker) {
  await worker.evaluate(() => {
    type TestWorker = typeof globalThis & {
      permissionE2eAllow?: boolean;
      permissionE2eCalls?: PermissionCall[];
      permissionE2eGrant?: (() => void) | null;
      permissionE2ePending?: boolean;
    };
    const testWorker = globalThis as TestWorker;
    testWorker.permissionE2eAllow = true;
    testWorker.permissionE2eCalls = [];
    testWorker.permissionE2eGrant = null;
    testWorker.permissionE2ePending = false;

    Object.defineProperty(chrome.permissions, 'contains', {
      configurable: true,
      value: async (permission: chrome.permissions.Permissions) =>
        permission.permissions?.includes('notifications')
          ? (await chrome.storage.local.get('notificationsE2ePermissionGranted'))
              .notificationsE2ePermissionGranted === true
          : permission.origins?.includes('https://api.telegram.org/*')
            ? (await chrome.storage.local.get('telegramE2ePermissionGranted'))
                .telegramE2ePermissionGranted === true
            : false,
    });
    Object.defineProperty(chrome.permissions, 'request', {
      configurable: true,
      value: async (permission: chrome.permissions.Permissions) => {
        const call: PermissionCall = {};
        if (permission.origins) call.origins = permission.origins;
        if (permission.permissions) call.permissions = permission.permissions;
        testWorker.permissionE2eCalls?.push(call);
        const allowed = await new Promise<boolean>((resolve) => {
          if (testWorker.permissionE2ePending) {
            testWorker.permissionE2eGrant = () => resolve(testWorker.permissionE2eAllow === true);
          } else {
            resolve(testWorker.permissionE2eAllow === true);
          }
        });
        if (allowed) {
          await chrome.storage.local.set({
            ...(permission.permissions?.includes('notifications')
              ? { notificationsE2ePermissionGranted: true }
              : {}),
            ...(permission.origins?.includes('https://api.telegram.org/*')
              ? { telegramE2ePermissionGranted: true }
              : {}),
          });
        }
        return allowed;
      },
    });
  });
}

export async function setPermissionRequest(worker: Worker, options: { allow?: boolean; pending?: boolean }) {
  await worker.evaluate(({ allow, pending }) => {
    type TestWorker = typeof globalThis & {
      permissionE2eAllow?: boolean;
      permissionE2ePending?: boolean;
    };
    const testWorker = globalThis as TestWorker;
    testWorker.permissionE2eAllow = allow ?? true;
    testWorker.permissionE2ePending = pending ?? false;
  }, options);
}

export async function grantPendingPermission(worker: Worker) {
  await worker.evaluate(() => {
    type TestWorker = typeof globalThis & { permissionE2eGrant?: (() => void) | null };
    const grant = (globalThis as TestWorker).permissionE2eGrant;
    if (!grant) throw new Error('No permission request is pending');
    grant();
    (globalThis as TestWorker).permissionE2eGrant = null;
  });
}

export async function getPermissionCalls(worker: Worker): Promise<PermissionCall[]> {
  return worker.evaluate(() => {
    type TestWorker = typeof globalThis & { permissionE2eCalls?: PermissionCall[] };
    return (globalThis as TestWorker).permissionE2eCalls ?? [];
  });
}
