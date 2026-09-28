declare module '*release-check-ui.mjs' {
  interface CommandOutput {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  }

  interface ReleaseCheckStep {
    name: string;
    command?: string[];
    run?: () => Promise<CommandOutput>;
  }

  interface ReleaseCheckOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    write?: (chunk: string) => void;
    executor?: (
      command: string[],
      options: { cwd?: string; env: Record<string, string | undefined> },
    ) => Promise<CommandOutput>;
    isInteractive?: boolean;
    color?: boolean;
  }

  export function runSteps(
    steps: ReleaseCheckStep[],
    options?: ReleaseCheckOptions,
  ): Promise<{ exitCode: number; results: unknown[] }>;
}

declare module '*release-archives.mjs' {
  interface ArchiveRecoveryOptions {
    outputDir: string;
    archivePattern: RegExp;
    expectedArchiveNames: string[];
  }

  export function withReleaseArchiveRecovery<T extends { exitCode: number }>(
    options: ArchiveRecoveryOptions,
    run: () => Promise<T>,
  ): Promise<T>;
}
