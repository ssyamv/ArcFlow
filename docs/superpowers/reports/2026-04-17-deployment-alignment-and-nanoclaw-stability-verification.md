# Deployment Alignment And NanoClaw Stability Verification

- Status: DONE
- Server: `arcflow-server` (`172.29.230.21`)
- ArcFlow repo HEAD on server: `3d857ef19ba5e4f16e4357bd840461c4fcef1fec`
- NanoClaw PM2 app: `arcflow-nanoclaw`

## Commands Run

- `python3 /Users/chenqi/.codex/skills/ssh-skill/scripts/ssh_execute.py arcflow-server "hostname && whoami && ... && docker compose ps && pm2 ls"`
  - Result: confirmed `arcflow-gateway` healthy on `3100`, `arcflow-web` serving on `80`, and `arcflow-nanoclaw` online under PM2.
- `python3 /Users/chenqi/.codex/skills/ssh-skill/scripts/ssh_execute.py arcflow-server "pm2 logs arcflow-nanoclaw --lines 160 --nostream"`
  - Result: historical `EACCES unlink`, stale session, and TypeScript build failures were confirmed as past failures; the still-recurring production warning was `OneCLI gateway not reachable`.
- `cd /Users/chenqi/code/nanoclaw && npm test -- src/container-runner.test.ts`
  - Result: passed after adding a regression test for the `ONECLI_URL`-unset path.
- `cd /Users/chenqi/code/nanoclaw && npm test -- src/container-runner.test.ts src/auth/credentials-file.test.ts src/channels/web.test.ts`
  - Result: passed, `26 passed`, `0 failed`.
- `cd /Users/chenqi/code/nanoclaw && npm run typecheck`
  - Result: failed on pre-existing unrelated issues in `assistant-events.test.ts`, `internal-tags*.test.ts`, `sdk-message-debug.test.ts`, and existing `web.test.ts` typing gaps. No new failures were introduced by the fix.
- `python3 /Users/chenqi/.codex/skills/ssh-skill/scripts/ssh_execute.py arcflow-server "cd /data/project/nanoclaw && npm test -- src/container-runner.test.ts"`
  - Result: passed on the production runtime checkout.
- `python3 /Users/chenqi/.codex/skills/ssh-skill/scripts/ssh_execute.py arcflow-server "cd /data/project/nanoclaw && npm run build"`
  - Result: passed.
- `python3 /Users/chenqi/.codex/skills/ssh-skill/scripts/ssh_execute.py arcflow-server "pm2 restart arcflow-nanoclaw && sleep 3 && pm2 ls && curl -sS http://127.0.0.1:3100/health && curl -I -sS http://127.0.0.1 | head -n 5"`
  - Result: restart succeeded, PM2 process came back online, Gateway `/health` returned `{"status":"ok"}`, and Web returned `HTTP/1.1 200 OK`.
- Production smoke dispatch via local NanoClaw web channel on `127.0.0.1:3002/api/chat` with `X-System-Secret`
  - Result: request accepted with `{"ok":true,"message_id":"web-1776414260046-b6r6iz"}` and triggered a real container run.

## Production Outcome

- New production container start logs now show:
  - `OneCLI gateway disabled — using env and mounted credential fallbacks`
  - `ArcFlow credentials mounted into container`
  - `Agent output: 8 chars`
- The previous recurring warning `OneCLI gateway not reachable — container will have no credentials` did not appear for the new post-fix smoke run.
- This matches the actual server state: OneCLI is not installed, `ONECLI_URL` is not configured, and ArcFlow credentials are delivered through the mounted credentials file fallback path.

## Notes

- Server drift still exists in deployment layout:
  - PM2 runs `/data/project/nanoclaw`
  - git-tracked source of truth on the server is `/data/project/nanoclaw-fork`
- Both locations were updated for this fix so the running code and the git-tracked server checkout stay aligned.
- A temporary smoke script was used during verification and should not be treated as part of the product codebase.
