import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

const base = __ENV.CW_K6_BASE_URL;
const runId = __ENV.CW_K6_RUN_ID;
const reportPath = __ENV.CW_K6_REPORT_PATH;
if (!base || !runId || !reportPath) throw new Error("CW_K6_BASE_URL, CW_K6_RUN_ID, and CW_K6_REPORT_PATH are required");
const routes = ["/", ...JSON.parse(__ENV.CW_K6_UI_ASSETS || "[]"), "/api/serve", "/api/index", `/api/run/${encodeURIComponent(runId)}`];
const reached = new Counter("cw_route_requests");
const stages = [["warmup",25,"30s","0s"],["sustained",100,"5m","30s"],["burst150",150,"60s","5m30s"],["burst200",200,"60s","6m30s"],["burst250",250,"60s","7m30s"]];
const thresholds = { dropped_iterations: ["count==0"] };
for (const [name] of stages) { thresholds[`http_req_duration{stage:${name}}`] = ["p(95)<100", "p(99)<250"]; thresholds[`http_req_failed{stage:${name}}`] = ["rate==0"]; thresholds[`checks{stage:${name}}`] = ["rate==1"]; }
for (const route of routes) thresholds[`cw_route_requests{route:${route}}`] = ["count>0"];
export const options = { scenarios: Object.fromEntries(stages.map(([name,rate,duration,startTime]) => [name,{executor:"constant-arrival-rate",rate,timeUnit:"1s",duration,startTime,preAllocatedVUs:300,maxVUs:300,exec:"request"}])), thresholds, summaryTrendStats:["min","avg","med","p(95)","p(99)"] };
export function request() { const stage=exec.scenario.name; const route=routes[(__VU*31+__ITER)%routes.length]; const response=http.get(`${base}${route}`,{tags:{stage,route}}); reached.add(1,{route}); check(response,{"status is 200":v=>v.status===200},{stage,route}); }
export function handleSummary(data) { const metrics={}; for (const name of Object.keys(data.metrics).filter(n=>n==="dropped_iterations"||n.startsWith("http_req_")||n.startsWith("checks")||n.startsWith("cw_route_requests")).sort()) metrics[name]={values:data.metrics[name].values||{},thresholds:Object.fromEntries(Object.entries(data.metrics[name].thresholds||{}).map(([k,v])=>[k,{ok:v.ok===true}]))}; return { [reportPath]: `${JSON.stringify({schemaVersion:1,benchmark:"cw-workbench-load",stages:stages.map(([name,rate,duration])=>({name,rate,duration})),routes,metrics},null,2)}\n` }; }
