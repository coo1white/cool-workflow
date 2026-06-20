# Cool Workflow — README hero demo (matches current CLI, v0.1.87+)
# Story: prove tamper-evidence -> one-command review -> cited report -> verify
#
# Setup (one-time):
#   npm install -g cool-workflow        # or use ./scripts/cw.js from a clone
#   brew install vhs                    # github.com/charmbracelet/vhs
#   # Record from inside a repo you want reviewed:
#   cd /path/to/some/repo
#   vhs /path/to/demo.tape              # writes ./demo.gif
#
# NOTE on the live agent run (beat 2): `cw -q` streams in real time, so its
# length depends on your agent. Two options:
#   (a) leave as-is and let it run — trim/replace the Sleep below to taste, or
#   (b) use the FAST VARIANT at the bottom (pre-run once, demo a saved run) for
#       a crisp ~25s GIF with no live wait.

Output demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set Margin 20
Set Padding 18
Set BorderRadius 10
Set WindowBar Colorful

Hide
Type "clear"
Enter
Show
Sleep 600ms

# 1. The hook: prove tamper-evidence in 30s, no agent needed
Type "cw demo tamper"
Sleep 400ms
Enter
Sleep 3s                       # → VERDICT: tamper-evidence holds ✓

# 2. One command runs a real review over the current repo
Type 'cw -q "What are the main risks here?"'
Sleep 400ms
Enter
Sleep 8s                       # live streaming — adjust to your agent's speed

# 3. The report is a saved file with cited file:line pointers
Hide
Type "RUN=$(ls -t .cw/runs | head -1)"   # grab the run just created
Enter
Show
Type "cat .cw/runs/$RUN/report.md | head -n 24"
Sleep 400ms
Enter
Sleep 3.5s

# 4. The payoff: verify the run's signed usage offline
Type "cw telemetry verify $RUN"
Sleep 400ms
Enter
Sleep 3.5s

Sleep 1.5s

# ───────────────────────── FAST VARIANT ─────────────────────────
# For a snappy, deterministic GIF with no live agent wait, run ONE real
# review before recording, then replace beats 2–4 above with just:
#
#   Hide
#   Type "RUN=$(ls -t .cw/runs | head -1)"
#   Enter
#   Show
#   Type "cw -q \"What are the main risks here?\"   # (pre-recorded run shown)"
#   Sleep 1s
#   Enter
#   Sleep 1.5s
#   Type "cat .cw/runs/$RUN/report.md | head -n 24"
#   Enter
#   Sleep 3.5s
#   Type "cw telemetry verify $RUN"
#   Enter
#   Sleep 3.5s
