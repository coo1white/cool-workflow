# VHS tape — records the `cw demo tamper` proof to a GIF for the README hero.
#
# Reproducible, deterministic capture (no manual screen-recording). Install VHS
# (https://github.com/charmbracelet/vhs), then from the repo root:
#
#   vhs plugins/cool-workflow/docs/launch/demo.tape
#
# Output: plugins/cool-workflow/docs/launch/demo-tamper.gif. The SHIPPED hero
# GIF is docs/assets/demo.gif (README.md:18) — after a fresh capture, copy it
# there so the README picks it up:
#   cp plugins/cool-workflow/docs/launch/demo-tamper.gif docs/assets/demo.gif

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
