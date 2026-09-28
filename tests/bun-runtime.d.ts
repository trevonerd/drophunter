declare const Bun: {
  spawnSync(options: {
    cmd: readonly string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdout?: 'pipe';
    stderr?: 'pipe';
  }): {
    success: boolean;
    exitCode?: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  file(path: string): {
    text(): Promise<string>;
  };
};

interface ImportMeta {
  readonly dir: string;
}
