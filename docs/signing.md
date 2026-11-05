# Signing approvals and sign-offs (D41)

Each approval and sign-off that the rehearse UI writes carries an SSH signature. `rehearse serve`
makes the signature with your git signing key:

```sh
ssh-keygen -Y sign -n rehearse
```

The signature covers a canonical JSON payload of the event. `rehearse gate check` verifies each
signature against `.rehearse/allowed_signers` at the repo root. The principal is the `by` email.

An approval without a valid signature is not evidence. A sign-off without a valid signature is
not trusted, and its stories must be signed again. The gate names the scenario or story and the
`sigStatus`:

| sigStatus | Meaning |
| --- | --- |
| `missing` | The event has no signature. |
| `invalid` | The signature does not match the content. |
| `unknown-signer` | The signature is good, but allowed_signers does not list the key for this email. |

## 1. Tell git to sign with an SSH key

`rehearse serve` uses the same settings as git commit signing:

```sh
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global user.email you@example.com
```

`user.signingkey` can be a key file (the `.pub` file, or the private key) or a literal key such as
`key::ssh-ed25519 AAAA…`. With a `.pub` file or a literal key, the private key must be in your
ssh-agent.

When the server starts, it prints the key it signs with, or the reason it cannot sign:

```text
Approve and sign-off as you@example.com, key SHA256:….
```

`GET /api/session` returns the same information. When the server cannot sign, the approve and
sign-off endpoints answer `503` with the reason, and they write nothing.

## 2. Keep the key in ssh-agent or behind a passphrase

D41 exists because "a button in the UI" is not enough protection on its own. An agent with a
shell can post to the local server, or it can write the YAML with a correct hash. A signature
stops this only when the agent cannot use your key. So:

- **Keep the private key in the ssh-agent** (`ssh-add ~/.ssh/id_ed25519`), and set
  `user.signingkey` to the `.pub` file. A sandboxed agent cannot reach the agent socket
  (`SSH_AUTH_SOCK`), so it cannot sign.
- **Or protect the key file with a passphrase** (`ssh-keygen -p -f ~/.ssh/id_ed25519`). An agent
  can read the file, but it cannot use it without the passphrase.

Do not use a key file with no passphrase. Any process that can read the file can sign as you.

Start `rehearse serve` yourself, in a terminal that can reach your ssh-agent. Do not start it from
a sandboxed agent.

## 3. Add your key to `.rehearse/allowed_signers`

`.rehearse/allowed_signers` uses git's allowed-signers format (see `man ssh-keygen`, section
ALLOWED SIGNERS). Each line has an email, the `rehearse` namespace, and a public key:

```text
you@example.com namespaces="rehearse" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@laptop
```

To add your key:

```sh
mkdir -p .rehearse
printf '%s namespaces="rehearse" %s\n' "$(git config user.email)" "$(cat ~/.ssh/id_ed25519.pub)" >> .rehearse/allowed_signers
```

Commit the file in a pull request. The email must be the git `user.email` that the server uses
as `by`.

A signature with a key that is not on the list, or that is listed for another email, is
`unknown-signer`. The server checks each new signature before it writes. If your key is not on
the list, the approve or sign-off fails with
`key SHA256:… is not in .rehearse/allowed_signers for you@example.com`.

## Remaining risk

An agent could add its own key to `.rehearse/allowed_signers`. For this reason:

- `rehearse gate check` lists each signer with its key fingerprint. Check that each key is one
  you know.
- A change to `.rehearse/allowed_signers` needs human review, like a change to `CODEOWNERS`.

## Old events

Approvals and sign-offs written before D41 have no `sig`. The gate reports them as
`sigStatus missing`. To make them count, approve the scenarios again and sign off the stories again
in the UI.
