// Starts the Electron app. VS Code passes ELECTRON_RUN_AS_NODE=1 to child processes, which
// would make electron.exe behave as plain Node, so it is removed here.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const p = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
p.on('close', (code) => process.exit(code ?? 0));
