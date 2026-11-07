// A stand-in for the rehearse CLI in tests.
//   serve <slug> --port N   listen on 127.0.0.1:N, print the URL like `rehearse serve`
//   exit <code> [text]      print text and exit with code
//   big <bytes>             print that many bytes
//   sleep                   never exit
//   (anything else)         print argv, cwd and SSH_AUTH_SOCK as JSON, exit 0
import { createServer } from 'node:http';

const [command, ...rest] = process.argv.slice(2);
if (command === 'serve') {
  const slug = rest[0];
  const port = Number(rest[rest.indexOf('--port') + 1]);
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>rehearse ${slug}</title><main data-slug="${slug}" data-pid="${process.pid}" data-bb-project="${process.env.REHEARSE_BB_PROJECT ?? ''}"></main>`);
  });
  server.on('error', (e) => {
    process.stderr.write(e.code === 'EADDRINUSE' ? `rehearse serve: port in use: ${port}\n` : `rehearse serve: ${e.message}\n`);
    process.exit(2);
  });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Serving ${slug} at http://127.0.0.1:${port}/\n`));
} else if (command === 'exit') {
  process.stdout.write(rest[1] ?? '');
  process.exit(Number(rest[0]));
} else if (command === 'big') {
  process.stdout.write('x'.repeat(Number(rest[0])));
} else if (command === 'sleep') {
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), sshAuthSock: process.env.SSH_AUTH_SOCK ?? null }));
}
