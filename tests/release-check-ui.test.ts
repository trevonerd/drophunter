import { describe, expect, test } from 'bun:test';
import { runSteps } from '../scripts/release-check-ui.mjs';

function createOutput() {
  const chunks: string[] = [];

  return {
    write: (chunk: string) => chunks.push(chunk),
    text: () => chunks.join(''),
  };
}

describe('release check UI runner', () => {
  test('prints ticks and a passing recap when all steps pass', async () => {
    const output = createOutput();

    const result = await runSteps(
      [
        { name: 'TypeScript', command: ['bun', 'run', 'test:ts'] },
        { name: 'Release manifest', run: async () => ({ stdout: 'manifest fresh\n' }) },
      ],
      {
        write: output.write,
        executor: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        isInteractive: false,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(output.text()).toContain('✓ TypeScript');
    expect(output.text()).toContain('✓ Release manifest');
    expect(output.text()).toContain('All release checks passed.');
  });

  test('adds a gradient synthwave banner with breathing room', async () => {
    const output = createOutput();

    await runSteps([{ name: 'TypeScript', command: ['bun', 'run', 'test:ts'] }], {
      write: output.write,
      executor: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      color: true,
      isInteractive: false,
    });

    expect(output.text()).toContain('\x1b[');
    expect(output.text()).toContain('◆ DropHunter Release Check ◆');
    expect(output.text()).toContain('━━━━━━━━');
    expect(output.text()).toContain('\n\n\x1b[38;5;141m…\x1b[0m TypeScript');
    expect(output.text()).toContain('\x1b[38;5;118m✓\x1b[0m TypeScript');
    expect(output.text()).toContain('0.0s\n\n\x1b[38;5;118m✦\x1b[0m All release checks passed.');
    expect(output.text()).toContain('\x1b[38;5;118m✦\x1b[0m All release checks passed.');
  });

  test('does not pass forced color settings to child commands', async () => {
    const output = createOutput();
    const originalForceColor = process.env.FORCE_COLOR;
    let childForceColor: string | undefined;
    let childNoColor: string | undefined;

    process.env.FORCE_COLOR = '1';

    try {
      await runSteps([{ name: 'Tests', command: ['bun', 'run', 'test'] }], {
        write: output.write,
        executor: async (_command, options) => {
          childForceColor = options.env.FORCE_COLOR;
          childNoColor = options.env.NO_COLOR;
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        isInteractive: false,
      });
    } finally {
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
    }

    expect(output.text()).toContain('\x1b[');
    expect(childForceColor).toBe('0');
    expect(childNoColor).toBe('1');
  });

  test('stops at the first failed step and prints its captured output', async () => {
    const output = createOutput();
    const commands: string[] = [];

    const result = await runSteps(
      [
        { name: 'TypeScript', command: ['bun', 'run', 'test:ts'] },
        { name: 'Biome', command: ['bun', 'run', 'lint'] },
      ],
      {
        write: output.write,
        executor: async (command) => {
          commands.push(command.join(' '));
          return { exitCode: 2, stdout: '', stderr: 'src/file.ts:1:1 error TS2304\n' };
        },
        isInteractive: false,
      },
    );

    expect(result.exitCode).toBe(2);
    expect(commands).toEqual(['bun run test:ts']);
    expect(output.text()).toContain('✕ TypeScript');
    expect(output.text()).toContain('Command: bun run test:ts');
    expect(output.text()).toContain('Exit code: 2');
    expect(output.text()).toContain('src/file.ts:1:1 error TS2304');
  });

  test('summarizes huge bun test failures without dumping the whole log', async () => {
    const output = createOutput();
    const noise = Array.from({ length: 80 }, (_value, index) => `(pass) noise test ${index}`).join('\n');

    await runSteps([{ name: 'Tests', command: ['bun', 'run', 'test'] }], {
      write: output.write,
      executor: async () => ({
        exitCode: 1,
        stdout: 'bun test v1.3.13\n',
        stderr: `${noise}
(fail) queue management > skips game after stalled recovery [2.14ms]
1096 |     expect(result).toBe(true)
                         ^
error: expect(received).toBe(expected)
Expected: true
Received: false
    at /Users/djtrevo/repos/drophunter/tests/queue-management.test.ts:1096:22
${noise}
`,
      }),
      isInteractive: false,
    });

    expect(output.text()).toContain('Error summary');
    expect(output.text()).toContain('tests/queue-management.test.ts:1096:22');
    expect(output.text()).toContain('(fail) queue management > skips game after stalled recovery');
    expect(output.text()).toContain('Expected: true');
    expect(output.text()).toContain('Received: false');
    expect(output.text()).not.toContain('(pass) noise test 79');
  });

  test('marks warning output without failing the release check', async () => {
    const output = createOutput();

    const result = await runSteps([{ name: 'Biome', command: ['bun', 'run', 'lint'] }], {
      write: output.write,
      executor: async () => ({ exitCode: 0, stdout: 'warning: suspicious rule\n', stderr: '' }),
      isInteractive: false,
    });

    expect(result.exitCode).toBe(0);
    expect(output.text()).toContain('⚠ Biome');
    expect(output.text()).toContain('Warnings');
    expect(output.text()).toContain('warning: suspicious rule');
  });

  test('prints custom release manifest errors in the failure recap', async () => {
    const output = createOutput();

    const result = await runSteps(
      [
        {
          name: 'Release manifest',
          run: async () => {
            throw new Error('permissions mismatch between source manifest and dist manifest');
          },
        },
      ],
      {
        write: output.write,
        isInteractive: false,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(output.text()).toContain('✕ Release manifest');
    expect(output.text()).toContain('permissions mismatch between source manifest and dist manifest');
  });
});
