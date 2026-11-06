// The words for a page whose server restarted twice under it (T24): the session client already
// read the new token once and the server still refused it, so only a reload helps.

import { SERVER_RESTARTED } from '../session-client.js';

export function isServerRestarted(message: string | undefined): boolean {
  return message === SERVER_RESTARTED;
}

export function ServerRestarted({ testId, className = 'warn' }: { testId?: string; className?: string }) {
  return (
    <p className={className} role="alert" data-testid={testId}>
      {SERVER_RESTARTED}{' '}
      <button type="button" className="action small" data-testid="server-restarted-reload" onClick={() => window.location.reload()}>
        Reload
      </button>
    </p>
  );
}
