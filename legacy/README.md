# legacy/

The family-relay mechanic from before the 2026-09-19 pivot: forwarded asks (intake), the family thread
bridge, and their tests. `AGENTS.md` section 14 puts all of it out of scope - Recall no longer relays a
family member's question to her, or her answer back.

Nothing here is built, type-checked, or tested, and nothing under `/lib`, `/app`, or `/server` may import
from it. It was moved here unchanged rather than deleted so the team can decide what, if anything, to keep.
The Telegram bot that used to sit here was deleted on 2026-09-19; it is in the git history (last present
at commit `29f3298`) if a safety-alert channel ever wants its client. Delete the rest of the folder once
that is decided: `git rm -r legacy`.
