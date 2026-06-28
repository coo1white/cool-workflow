import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const serveTime = new Trend("serve_time");
const indexTime = new Trend("index_time");
const runTime = new Trend("run_time");

const BASE = "http://127.0.0.1:7717";
const RUN_IDS = [
  "release-cut-20260619T100531Z-b8953d", // small (24KB state)
  "release-cut-20260626T101451Z-f2c268", // medium (580KB state)
  "architecture-review-20260621T151157Z-1c85e2", // large (1MB state)
];

export const options = {
  scenarios: {
    serve: {
      executor: "constant-arrival-rate",
      rate: 200,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: "testServe",
      tags: { scenario: "serve" },
    },
    index: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: "testIndex",
      tags: { scenario: "index" },
    },
    run: {
      executor: "constant-arrival-rate",
      rate: 20,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 8,
      maxVUs: 20,
      exec: "testRun",
      tags: { scenario: "run" },
    },
  },
  thresholds: {
    "http_req_duration{scenario:serve}": ["p(95)<500"],
    "http_req_duration{scenario:index}": ["p(95)<2000"],
    "http_req_duration{scenario:run}": ["p(95)<5000"],
    errors: ["rate<0.01"],
  },
  summaryTrendStats: ["min", "avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function testServe() {
  const res = http.get(`${BASE}/api/serve`, { tags: { scenario: "serve" } });
  const ok = check(res, {
    "serve: status 200": (r) => r.status === 200,
  });
  errorRate.add(!ok);
  serveTime.add(res.timings.duration);
}

export function testIndex() {
  const res = http.get(`${BASE}/api/index`, { tags: { scenario: "index" } });
  const ok = check(res, {
    "index: status 200": (r) => r.status === 200,
  });
  errorRate.add(!ok);
  indexTime.add(res.timings.duration);
}

export function testRun() {
  const runId = RUN_IDS[Math.floor(Math.random() * RUN_IDS.length)];
  const res = http.get(`${BASE}/api/run/${runId}`, { tags: { scenario: "run" } });
  const ok = check(res, {
    "run: status 200": (r) => r.status === 200,
  });
  errorRate.add(!ok);
  runTime.add(res.timings.duration);
}
