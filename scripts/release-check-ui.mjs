import { spawn } from 'node:child_process';

const WARNING_PATTERN = /(^|\n)\s*warn(?:ing)?\b|⚠/i;
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  pink: '\x1b[38;5;198m',
  cyan: '\x1b[38;5;51m',
  purple: '\x1b[38;5;141m',
  green: '\x1b[38;5;118m',
  yellow: '\x1b[38;5;226m',
  red: '\x1b[38;5;203m',
};

function now() {
  return performance.now();
}

function formatDuration(startedAt, finishedAt) {
  return `${((finishedAt - startedAt) / 1000).toFixed(1)}s`;
}

function commandLabel(command) {
  return command.join(' ');
}

function normalizeOutput(output) {
  return {
    exitCode: output?.exitCode ?? 0,
    stdout: output?.stdout ?? '',
    stderr: output?.stderr ?? '',
  };
}

function outputText(result) {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function hasWarningOutput(result) {
  return WARNING_PATTERN.test(outputText(result));
}

function paint(enabled, color, text) {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function bold(enabled, text) {
  return enabled ? `${ANSI.bold}${text}${ANSI.reset}` : text;
}

function gradientText(enabled, leftColor, rightColor, text) {
  if (!enabled) {
    return text;
  }

  const midpoint = Math.ceil(text.length / 2);
  return `${ANSI[leftColor]}${text.slice(0, midpoint)}${ANSI[rightColor]}${text.slice(midpoint)}${ANSI.reset}`;
}

function shouldUseColor(options, isInteractive) {
  if (typeof options.color === 'boolean') {
    return options.color;
  }

  return isInteractive || process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === 'true';
}

function childEnv(env = process.env) {
  return {
    ...env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };
}

function formatBanner(useColor) {
  const title = '◆ DropHunter Release Check ◆';
  const rule = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

  return [
    gradientText(useColor, 'pink', 'cyan', rule),
    bold(useColor, paint(useColor, 'pink', title)),
    gradientText(useColor, 'cyan', 'pink', rule),
    '',
    '',
  ].join('\n');
}

function formatRunningLine(name, useColor) {
  return `${paint(useColor, 'purple', '…')} ${name}`;
}

function formatDoneLine(icon, name, duration, color, useColor) {
  return `${paint(useColor, color, icon)} ${name} ${duration}`;
}

function writeStatus(write, line, isInteractive) {
  if (isInteractive) {
    write(`\r\x1b[2K${line}`);
    return;
  }

  write(`${line}\n`);
}

function writeDone(write, line, isInteractive) {
  if (isInteractive) {
    write(`\r\x1b[2K${line}\n`);
    return;
  }

  write(`${line}\n`);
}

function formatOutputBlock(result) {
  const sections = [];

  if (result.stdout.trim()) {
    sections.push(`stdout:\n${result.stdout.trimEnd()}`);
  }

  if (result.stderr.trim()) {
    sections.push(`stderr:\n${result.stderr.trimEnd()}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : 'No output captured.';
}

function formatStepRecap(result) {
  const useColor = result.useColor ?? false;
  const lines = [bold(useColor, result.name)];

  if (result.command) {
    lines.push(`${paint(useColor, 'purple', 'Command:')} ${commandLabel(result.command)}`);
  }

  if (result.status === 'failed') {
    lines.push(`${paint(useColor, 'red', 'Exit code:')} ${result.exitCode}`);
  }

  lines.push('', formatOutputBlock(result));

  return lines.join('\n');
}

export async function executeCommand(command, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on('close', (code, signal) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr: signal ? `${stderr}Terminated by signal ${signal}\n` : stderr,
      });
    });
  });
}

export async function runSteps(steps, options = {}) {
  const write = options.write ?? ((chunk) => process.stdout.write(chunk));
  const executor = options.executor ?? executeCommand;
  const executionOptions = {
    cwd: options.cwd,
    env: childEnv(options.env),
  };
  const isInteractive = options.isInteractive ?? Boolean(process.stdout.isTTY);
  const useColor = shouldUseColor(options, isInteractive);
  const results = [];

  write(formatBanner(useColor));

  for (const step of steps) {
    writeStatus(write, formatRunningLine(step.name, useColor), isInteractive);

    const startedAt = now();
    let output;

    try {
      output = step.run ? await step.run() : await executor(step.command, executionOptions);
    } catch (error) {
      output = {
        exitCode: error.exitCode ?? 1,
        stdout: '',
        stderr: `${error.message}\n`,
      };
    }

    const finishedAt = now();
    const result = {
      ...normalizeOutput(output),
      name: step.name,
      command: step.command,
      duration: formatDuration(startedAt, finishedAt),
      useColor,
    };

    if (result.exitCode !== 0) {
      result.status = 'failed';
      writeDone(write, formatDoneLine('✕', result.name, result.duration, 'red', useColor), isInteractive);
      write(`\n${paint(useColor, 'red', 'Release check failed.')}\n\n${formatStepRecap(result)}\n`);
      results.push(result);

      return { exitCode: result.exitCode, results };
    }

    result.status = hasWarningOutput(result) ? 'warning' : 'passed';
    const icon = result.status === 'warning' ? '⚠' : '✓';
    const color = result.status === 'warning' ? 'yellow' : 'green';
    writeDone(write, formatDoneLine(icon, result.name, result.duration, color, useColor), isInteractive);
    results.push(result);
  }

  const warnings = results.filter((result) => result.status === 'warning');

  if (warnings.length > 0) {
    write(`\n${paint(useColor, 'yellow', 'Warnings')}\n\n`);
    write(`${warnings.map(formatStepRecap).join('\n\n')}\n\n`);
  }

  write(`\n${paint(useColor, 'green', '✦')} All release checks passed.\n`);

  return { exitCode: 0, results };
}
