import http from "k6/http";
import { check } from "k6";

const BASE = "http://127.0.0.1:7717";
const RUN_ID = "architecture-review-20260621T151157Z-1c85e2";

export const options = {
  scenarios: {
    serve: {
      executor: "constant-arrival-rate",
      rate: 20, timeUnit: "1s", duration: "5s",
      preAllocatedVUs: 5, maxVUs: 10,
    },
    run: {
      executor: "constant-arrival-rate",
      rate: 5, timeUnit: "1s", duration: "5s",
      preAllocatedVUs: 3, maxVUs: 5,
    },
  },
  thresholds: {},
  summaryTrendStats: ["min", "avg", "med", "p(95)"],
};

export default function() {
  const isServe = Math.random() < 0.8;
  const url = isServe ? `${BASE}/api/serve` : `${BASE}/api/run/${RUN_ID}`;
  http.get(url);
}
