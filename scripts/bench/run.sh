#!/usr/bin/env bash
set -euo pipefail
# bench/run.sh v2 — simplified benchmark runner.
# Output: CSV line to stdout.
#
# Usage: ./run.sh --arch <name> --agent <name> --conc <N> [--runs <N>]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugins/cool-workflow"
STUB="$SCRIPT_DIR/agent-stub.js"
K6_SCRIPT="$SCRIPT_DIR/bench-k6.js"
BENCH_WORK="/tmp/cw-bench-work-$$"

ARCH="ARM64"
AGENT="claude"
RUNS=3
CONC=4
DOCKER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --agent) AGENT="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --conc) CONC="$2"; shift 2 ;;
    --docker) DOCKER="$2"; shift 2 ;;  # docker image tag, e.g. "18" or "22"
    *) shift ;;
  esac
done

case "$AGENT" in
  claude)   DELAY_MS=45000 ;;
  gemini)   DELAY_MS=30000 ;;
  deepseek) DELAY_MS=20000 ;;
  codex)    DELAY_MS=25000 ;;
  *) echo "Unknown agent: $AGENT" >&2; exit 1 ;;
esac

now_ms() { perl -MTime::HiRes=time -e 'print int(time*1000)'; }

echo "=== $ARCH / conc=$CONC / $AGENT (delay=${DELAY_MS}ms, runs=$RUNS) ===" >&2

rm -rf "$BENCH_WORK" 2>/dev/null || true
mkdir -p "$BENCH_WORK"
echo "# benchmark target repo" > "$BENCH_WORK/README.md"

# ---- k6 ----
K6_RPS="N/A"
K6_P95="N/A"
echo "  k6: starting workbench..." >&2
pushd "$PLUGIN_DIR" > /dev/null
node dist/cli.js workbench serve --port 7717 > /dev/null 2>&1 &
WB_PID=$!
sleep 3
if command -v k6 &>/dev/null && curl -sf "http://127.0.0.1:7717/api/serve" > /dev/null 2>&1; then
  K6_OUT=$(k6 run --quiet "$K6_SCRIPT" 2>&1) || true
  K6_RPS=$(echo "$K6_OUT" | grep "http_reqs" | grep -oE '[0-9.]+\/s' | head -1 | sed 's/\/s//') || K6_RPS="N/A"
  K6_P95=$(echo "$K6_OUT" | grep "http_req_duration" | grep -oE 'p\(95\)=[0-9.]+[a-z]*' | sed 's/.*=//' | sed 's/[a-z]//g' | head -1) || K6_P95="N/A"
  echo "  k6: rps=$K6_RPS p95=${K6_P95}ms" >&2
fi
kill "$WB_PID" 2>/dev/null || true
wait "$WB_PID" 2>/dev/null || true
popd > /dev/null

# ---- CW plan + drive ----
echo "  cw: $RUNS runs..." >&2
TOTAL_MS=0 TOTAL_PLAN_MS=0 BEST_MS=9999999

for i in $(seq 1 "$RUNS"); do
  rm -rf "$BENCH_WORK/.cw" 2>/dev/null || true
  
  # Step 1: plan
  PLAN_START=$(now_ms)
  CW_PLAN=$(cd "$BENCH_WORK" && node "$PLUGIN_DIR/dist/cli.js" plan architecture-review-fast \
    --repo "$BENCH_WORK" --question "bench$i" 2>&1)
  PLAN_MS=$(($(now_ms) - PLAN_START))
  TOTAL_PLAN_MS=$((TOTAL_PLAN_MS + PLAN_MS))
  RUN_ID=$(echo "$CW_PLAN" | python3 -c "import sys,json; print(json.load(sys.stdin)['runId'])" 2>/dev/null || echo "")
  
  # Step 2: drive (must run from the same repo cwd)
  DRIVE_START=$(now_ms)
  CW_OUT=$(cd "$BENCH_WORK" && node "$PLUGIN_DIR/dist/cli.js" run --drive \
    --run "$RUN_ID" \
    --agent-command "node $STUB --agent $AGENT --delay-ms $DELAY_MS {{result}}" \
    --concurrency "$CONC" 2>&1)
  DRIVE_MS=$(($(now_ms) - DRIVE_START))
  
  ELAPSED=$((PLAN_MS + DRIVE_MS))
  TOTAL_MS=$((TOTAL_MS + ELAPSED))
  [ "$ELAPSED" -lt "$BEST_MS" ] && BEST_MS=$ELAPSED
  
  STATUS=$(echo "$CW_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "?")
  COMP=$(echo "$CW_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('completedWorkers','?'))" 2>/dev/null || echo "?")
  echo "    $i: plan=${PLAN_MS}ms drive=${DRIVE_MS}ms total=${ELAPSED}ms status=$STATUS completed=$COMP" >&2
done

MEAN_MS=$((TOTAL_MS / RUNS))
MEAN_PLAN_MS=$((TOTAL_PLAN_MS / RUNS))

# app: Map(2) Assess(2) Verify(1) Verdict(1)
# autoWidth = min(maxConcurrentAgents, tasks) = 2 for Map+Assess
# rounds = ceil(2/2) + ceil(2/2) + 1 + 1 = 4
ROUNDS=4
EXPECTED=$(( DELAY_MS * ROUNDS ))
OVERHEAD_MS=$(( MEAN_MS - MEAN_PLAN_MS - EXPECTED ))

rm -rf "$BENCH_WORK" 2>/dev/null || true

printf "%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n" \
  "$ARCH" "22" "$CONC" "$AGENT" \
  "$MEAN_PLAN_MS" "$OVERHEAD_MS" "$MEAN_MS" \
  "${K6_RPS}" "${K6_P95}" \
  "${DELAY_MS}"
