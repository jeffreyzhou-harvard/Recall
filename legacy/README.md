# legacy/

The family-relay mechanic from before the 2026-09-19 pivot: forwarded asks (intake), the family thread
bridge, the Telegram bot, and their tests. `AGENTS.md` section 14 puts all of it out of scope - Relay
no longer relays a family member's question to her, or her answer back.

Nothing here is built, type-checked, or tested, and nothing under `/lib`, `/app`, or `/server` may import
from it. It was moved here unchanged rather than deleted so the team can decide what, if anything, to keep
(the Telegram client in `lib/bridge/telegram/api.ts` could serve as a safety-alert channel). Delete the
folder once that is decided: `git rm -r legacy`.
