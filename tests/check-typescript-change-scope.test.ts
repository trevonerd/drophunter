import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { runCheckerAt } from '../scripts/check-typescript-change-scope';

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const fixtureDirectories: string[] = [];
const TEST_TIMEOUT_MS = 30_000;

function gitCommandEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('GIT_')) delete environment[key];
  }
  return environment;
}

function run(command: readonly string[], cwd: string): CommandResult {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd,
    env: gitCommandEnvironment(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.success ? 0 : (result.exitCode ?? 1),
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function createFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'drophunter-typescript-scope-'));
  fixtureDirectories.push(directory);
  mkdirSync(join(directory, 'src'), { recursive: true });
  const git = (args: readonly string[]): CommandResult => run(['git', ...args], directory);
  expect(git(['init', '-q']).exitCode).toBe(0);
  expect(git(['config', 'user.email', 'scope-test@example.invalid']).exitCode).toBe(0);
  expect(git(['config', 'user.name', 'Scope Test']).exitCode).toBe(0);
  writeFileSync(join(directory, '.gitkeep'), '', 'utf8');
  expect(git(['add', '.']).exitCode).toBe(0);
  expect(git(['commit', '--no-gpg-sign', '--no-verify', '-qm', 'fixture base']).exitCode).toBe(0);
  return directory;
}

function runChecker(directory: string, base = 'HEAD'): CommandResult {
  return runCheckerAt(directory, base);
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);

describe('changed TypeScript scope checker', () => {
  test.serial(
    'accepts any property access without allowing explicit any types',
    () => {
      const directory = createFixture();
      writeFileSync(join(directory, 'src', 'matchers.ts'), 'expect.any(Number);\nexpect?.any(Number);\n');
      expect(runChecker(directory).exitCode).toBe(0);
      writeFileSync(join(directory, 'src', 'matchers.ts'), 'const value: any = input as any;\n');
      expect(runChecker(directory).stderr).toContain('[no-any-annotation]');
      expect(runChecker(directory).stderr).toContain('[no-any-assertion]');
    },
    TEST_TIMEOUT_MS,
  );
  test.serial(
    'finishes scanning URL regular expressions containing a hash',
    () => {
      const directory = createFixture();
      writeFileSync(
        join(directory, 'src', 'url.ts'),
        'const match = href.match(/\\/directory\\/category\\/([^/?#]+)/);\n',
      );
      const result = runChecker(directory);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('src/url.ts: 1 pure LOC');
    },
    TEST_TIMEOUT_MS,
  );

  test.serial(
    'accepts 250 typed code lines',
    () => {
      const directory = createFixture();
      const source = Array.from({ length: 250 }, (_, index) => `const value${index} = ${index};`).join('\n');
      writeFileSync(join(directory, 'src', 'within-limit.ts'), source, 'utf8');

      const result = runChecker(directory);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('src/within-limit.ts: 250 pure LOC');
      expect(result.stdout).toContain('Scanned 1 TypeScript file(s).');
    },
    TEST_TIMEOUT_MS,
  );

  test.serial(
    'reports every changed-file violation',
    () => {
      const directory = createFixture();
      const oversized = Array.from({ length: 251 }, (_, index) => `const value${index} = ${index};`).join(
        '\n',
      );
      writeFileSync(join(directory, 'src', 'oversized.ts'), oversized, 'utf8');
      mkdirSync(join(directory, 'tests'), { recursive: true });
      writeFileSync(
        join(directory, 'tests', 'violations.ts'),
        [
          'const anyValue = value as any;',
          'const annotatedValue: any = value;',
          'const unknownValue = value as unknown;',
          'const nullableValue = value!;',
          'enum Forbidden { Value }',
          '// @ts-ignore',
          '// @ts-expect-error',
        ].join('\n'),
        'utf8',
      );

      const result = runChecker(directory);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('src/oversized.ts: 251 pure LOC');
      expect(result.stderr).toContain('[no-any-assertion]');
      expect(result.stderr).toContain('[no-any-annotation]');
      expect(result.stderr).toContain('[no-unknown-assertion]');
      expect(result.stderr).toContain('[no-non-null-assertion]');
      expect(result.stderr).toContain('[no-enum]');
      expect(result.stderr).toContain('[no-ts-ignore]');
      expect(result.stderr).toContain('[no-ts-expect-error]');
      expect(result.stderr).toContain('tests/violations.ts');
    },
    TEST_TIMEOUT_MS,
  );

  test.serial(
    'grandfathers an existing oversized file while still rejecting files that cross the limit',
    () => {
      const directory = createFixture();
      const source = Array.from({ length: 260 }, (_, index) => `const value${index} = ${index};`).join('\n');
      writeFileSync(join(directory, 'src', 'legacy-large.ts'), source, 'utf8');
      expect(run(['git', 'add', 'src/legacy-large.ts'], directory).exitCode).toBe(0);
      expect(
        run(['git', 'commit', '--no-gpg-sign', '--no-verify', '-qm', 'legacy oversized file'], directory)
          .exitCode,
      ).toBe(0);

      writeFileSync(
        join(directory, 'src', 'legacy-large.ts'),
        source.replace('value0 = 0', 'value0 = 1'),
        'utf8',
      );
      expect(runChecker(directory).exitCode).toBe(0);

      writeFileSync(join(directory, 'src', 'legacy-large.ts'), `${source}\nconst added = true;`, 'utf8');
      expect(runChecker(directory).exitCode).toBe(0);

      const withinLimit = Array.from({ length: 250 }, (_, index) => `const fresh${index} = ${index};`).join(
        '\n',
      );
      writeFileSync(join(directory, 'src', 'crosses-limit.ts'), withinLimit, 'utf8');
      expect(run(['git', 'add', 'src/crosses-limit.ts'], directory).exitCode).toBe(0);
      expect(
        run(['git', 'commit', '--no-gpg-sign', '--no-verify', '-qm', 'file at size limit'], directory)
          .exitCode,
      ).toBe(0);
      writeFileSync(
        join(directory, 'src', 'crosses-limit.ts'),
        `${withinLimit}\nconst added = true;`,
        'utf8',
      );

      const crossed = runChecker(directory);
      expect(crossed.exitCode).toBe(1);
      expect(crossed.stderr).toContain('251 pure LOC exceeds 250');
    },
    TEST_TIMEOUT_MS,
  );

  test.serial(
    'lists changed TypeScript deterministically and ignores deleted or unrelated files',
    () => {
      const directory = createFixture();
      const base = run(['git', 'rev-parse', 'HEAD'], directory).stdout.trim();
      writeFileSync(join(directory, 'src', 'tracked.ts'), 'const tracked = true;\n', 'utf8');
      expect(run(['git', 'add', 'src/tracked.ts'], directory).exitCode).toBe(0);
      expect(
        run(['git', 'commit', '--no-gpg-sign', '--no-verify', '-qm', 'tracked fixture'], directory).exitCode,
      ).toBe(0);
      writeFileSync(join(directory, 'src', 'tracked.ts'), 'const tracked = false;\n', 'utf8');
      writeFileSync(join(directory, 'src', 'zeta.ts'), 'const zeta = true;\n', 'utf8');
      mkdirSync(join(directory, 'tests'), { recursive: true });
      writeFileSync(join(directory, 'tests', 'alpha.ts'), 'const alpha = true;\n', 'utf8');
      writeFileSync(join(directory, 'README.md'), 'const ignored = true;\n', 'utf8');
      writeFileSync(join(directory, 'src', 'deleted.ts'), 'const deleted = true;\n', 'utf8');
      expect(run(['git', 'add', 'src/deleted.ts'], directory).exitCode).toBe(0);
      expect(
        run(['git', 'commit', '--no-gpg-sign', '--no-verify', '-qm', 'deleted fixture'], directory).exitCode,
      ).toBe(0);
      rmSync(join(directory, 'src', 'deleted.ts'));

      const result = runChecker(directory, base);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.exitCode).toBe(0);
      expect(output.indexOf('src/zeta.ts')).toBeLessThan(output.indexOf('tests/alpha.ts'));
      expect(output).toContain('tracked.ts');
      expect(output).not.toContain('deleted.ts');
      expect(output).not.toContain('README.md');
      expect(readFileSync(join(directory, 'src', 'tracked.ts'), 'utf8')).toContain('false');
    },
    TEST_TIMEOUT_MS,
  );
});
