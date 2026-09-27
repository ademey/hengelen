import { build } from 'vite';

let finishFirstBuild;
const firstBuild = new Promise((resolve) => {
  finishFirstBuild = resolve;
});
let buildCount = 0;

const watcher = await build({
  plugins: [
    {
      name: 'hengelen-dev-ready',
      closeBundle() {
        buildCount += 1;
        if (buildCount === 1) finishFirstBuild();
        else console.log('Client rebuilt. Reload the browser to see the latest changes.');
      },
    },
  ],
  build: { watch: {} },
});

await firstBuild;
await import('./server.mjs');

async function stop() {
  await watcher.close();
  process.exit();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
