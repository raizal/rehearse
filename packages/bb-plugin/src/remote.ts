// How a viewer on another device sees the panel (R12, T67). There are 2 ways, in this order:
// 1. The machine tunnel of bb connect: a share of the serve port. The host needs a bb connect
//    machine credential.
// 2. The relay (relay.ts): the plugin's own route on the bb server. Only for a serve process on
//    the machine of the bb server, because the relay goes to 127.0.0.1.
// If no way works, the panel tells the owner what to do.

export interface RemoteWays {
  /** The serve port on the repo's machine. */
  port: number;
  /** Share the port through the machine tunnel and give its URL. Throws if the host cannot share. */
  tunnel: () => Promise<string>;
  /** The relay URL, or null if the serve process is not on the bb server's machine. */
  relay: string | null;
}

export interface RemoteView {
  url: string | null;
  via: 'tunnel' | 'relay' | null;
  /** Why `url` is null, in words for the owner. */
  remoteError: string | null;
}

export async function remoteView(ways: RemoteWays): Promise<RemoteView> {
  try {
    return { url: await ways.tunnel(), via: 'tunnel', remoteError: null };
  } catch (e) {
    if (ways.relay !== null) return { url: ways.relay, via: 'relay', remoteError: null };
    return { url: null, via: null, remoteError: noRemoteText(e instanceof Error ? e.message : String(e), ways.port) };
  }
}

/** The panel text when no way works: the cause, and the manual way with the port. */
export function noRemoteText(cause: string, port: number): string {
  const reason = cause.trim().replace(/[.\s]+$/, '');
  return [
    'The panel cannot open here through bb connect.',
    `The cause: ${reason || 'no reason given'}.`,
    'To see the panel, open it in the bb app on the machine that has the repo.',
    `Or, on that machine, run this command: bb connect expose ${port}`,
    'Then open the address that the command shows.',
  ].join(' ');
}
