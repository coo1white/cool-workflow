# VHS tape — records the `cw demo tamper` proof to a GIF for the README hero.
#
# Reproducible, deterministic capture (no manual screen-recording). Install VHS
# (https://github.com/charmbracelet/vhs), then from the repo root:
#
#   vhs plugins/cool-workflow/docs/launch/demo.tape
#
# Output: docs/launch/demo-tamper.gif. Then in the root README, replace the
# fenced demo output block under "See it in 30 seconds" with:
#   ![cw demo tamper](plugins/cool-workflow/docs/launch/demo-tamper.gif)

Output plugins/cool-workflow/docs/launch/demo-tamper.gif

Set FontSize 15
Set Width 1180
Set Height 760
Set Padding 18
Set Theme "Dracula"
Set Framerate 24
Set PlaybackSpeed 1.0

# Use the published package so the GIF reflects exactly what a new user runs.
Type "npx cool-workflow demo tamper"
Sleep 600ms
Enter

# Allow npx fetch + the demo to run and print the verdict.
Sleep 14s
