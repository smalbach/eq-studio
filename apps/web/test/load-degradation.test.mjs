import assert from "node:assert/strict";
import test from "node:test";
import { baselineOf, degradationReport, degradationSignals, healthLabel, HEALTH, latencyLimit, recoveryTime, stageHealth } from "../src/lib/load-degradation.mjs";

/** A window with sensible defaults: 10 ms, everything delivered, nothing in error. */
const win = (t, stage, rps, extra = {}) => ({ t, stage, targetRps: rps, inFlight: 1, completed: rps, errors: 0, dropped: 0, errorRate: 0, rps, p50: 8, p95: 10, p99: 12, ...extra });
const stage = (label, rate, extra = {}) => ({ label, durationS: 5, fromRps: rate, toRps: rate, measured: true, completed: rate * 5, errors: 0, dropped: 0, errorRate: 0, rps: rate, p50: 8, p95: 10, p99: 12, statuses: {}, ...extra });

/** Five stress steps: calm, calm, latency climbs, the queue builds, it breaks. */
function stressReport() {
  const rates = [20, 40, 60, 80, 100];
  const windows = [];
  rates.forEach((rate, index) => {
    for (let second = 0; second < 5; second += 1) {
      const t = index * 5 + second + 1;
      if (index < 2) windows.push(win(t, index, rate));
      else if (index === 2) windows.push(win(t, index, rate, { p50: 20, p95: 45, p99: 60, inFlight: 3 }));
      else if (index === 3) windows.push(win(t, index, rate, { p50: 40, p95: 120, p99: 300, inFlight: 12 }));
      else windows.push(win(t, index, rate, { rps: 70, completed: 70, p50: 200, p95: 900, p99: 1500, inFlight: 60, errors: 3, errorRate: 3 / 70, dropped: 5 }));
    }
  });
  windows.push({ ...win(26, 4, 0), targetRps: null, drain: true, p95: 5000 });
  const stages = [
    stage("Escalón 1 · 20 req/s", 20), stage("Escalón 2 · 40 req/s", 40),
    stage("Escalón 3 · 60 req/s", 60, { p50: 20, p95: 45, p99: 60 }),
    stage("Escalón 4 · 80 req/s", 80, { p50: 40, p95: 120, p99: 300 }),
    stage("Escalón 5 · 100 req/s", 100, { rps: 70, p50: 200, p95: 900, p99: 1500, errors: 15, errorRate: 15 / 350, dropped: 25 }),
  ];
  return { stages, windows };
}

test("the baseline of a stress test is its first step, without its cold first second", () => {
  const report = stressReport();
  report.windows[0] = { ...report.windows[0], p95: 400 };
  const baseline = baselineOf("stress", report);
  assert.equal(baseline.p95, 10);
  assert.equal(baseline.rps, 20);
  assert.equal(baseline.seconds, 4);
});

test("the degrading limit has an absolute floor so a fast local p95 is not noise", () => {
  assert.equal(latencyLimit({ p95: 4 }), 24);
  assert.equal(latencyLimit({ p95: 200 }), 300);
});

test("each stage gets the worst of its states, with the reason in words", () => {
  const baseline = { p50: 8, p95: 10, rps: 20, inFlight: 1 };
  assert.equal(stageHealth(stage("calm", 20), baseline, null).health, "healthy");
  const slow = stageHealth(stage("slow", 60, { p95: 45 }), baseline, null);
  assert.equal(slow.health, "degrading");
  assert.match(slow.reasons[0], /×4\.5/);
  assert.equal(stageHealth(stage("over", 60, { p95: 80 }), baseline, 70).health, "saturated");
  assert.equal(stageHealth(stage("near", 60, { p95: 60 }), { ...baseline, p95: 50 }, 70).health, "degrading");
  assert.equal(stageHealth(stage("short", 100, { rps: 70 }), baseline, null).health, "broken");
  assert.equal(stageHealth(stage("errors", 100, { errorRate: 0.005 }), baseline, null).health, "saturated");
});

test("signals are the first second each sign held for two seconds, in order", () => {
  const report = stressReport();
  const signals = degradationSignals(report, baselineOf("stress", report), null);
  assert.deepEqual(signals.map((signal) => signal.key), ["latency", "tail", "queue", "throughput", "errors", "drops"]);
  assert.equal(signals[0].t, 11);
  assert.equal(signals[0].rps, 60);
  assert.equal(signals[0].stage, "Escalón 3 · 60 req/s");
});

test("one slow second is not a signal", () => {
  const report = stressReport();
  report.windows = report.windows.slice(0, 10);
  report.windows[6] = { ...report.windows[6], p95: 500 };
  assert.deepEqual(degradationSignals(report, baselineOf("stress", report), null), []);
});

test("the report names where it starts to bend, where it breaks and the healthy capacity", () => {
  const analysis = degradationReport("stress", stressReport(), null);
  assert.deepEqual(analysis.stages.map((item) => item.health), ["healthy", "healthy", "degrading", "degrading", "broken"]);
  assert.equal(analysis.firstDegraded.label, "Escalón 3 · 60 req/s");
  assert.equal(analysis.firstBroken.label, "Escalón 5 · 100 req/s");
  assert.deepEqual(analysis.capacity, { rps: 40, stage: "Escalón 2 · 40 req/s" });
  assert.equal(analysis.headroom, 2);
  // The drain window is left out of the timeline.
  assert.equal(analysis.timeline.length, 25);
  assert.equal(analysis.timeline[0].factor, 1);
});

test("a spike's recovery is the seconds until three calm seconds in a row", () => {
  const windows = [
    ...[1, 2, 3, 4, 5].map((t) => win(t, 0, 20)),
    ...[6, 7, 8].map((t) => win(t, 1, 200, { p95: 80 })),
    win(9, 2, 20, { p95: 60 }), win(10, 2, 20, { p95: 40 }), win(11, 2, 20), win(12, 2, 20), win(13, 2, 20), win(14, 2, 20),
  ];
  const report = { stages: [stage("Base · 20 req/s", 20), stage("Pico · 200 req/s", 200, { p95: 80 }), stage("Recuperación · 20 req/s", 20)], windows };
  const recovery = recoveryTime(report, baselineOf("spike", report));
  assert.equal(recovery.seconds, 3);
  assert.equal(recovery.peakFactor, 8);
  report.windows = report.windows.map((window) => window.stage === 2 ? { ...window, p95: 70 } : window);
  assert.equal(recoveryTime(report, baselineOf("spike", report)).seconds, null);
});

test("in English the reasons, signals and health labels are English; Spanish stays the default", () => {
  const spanish = degradationReport("stress", stressReport(), null);
  const english = degradationReport("stress", stressReport(), null, "en");
  // Same analysis, other words.
  assert.deepEqual(english.stages.map((item) => item.health), spanish.stages.map((item) => item.health));
  assert.deepEqual(english.signals.map((signal) => signal.key), spanish.signals.map((signal) => signal.key));
  assert.ok(spanish.signals.some((signal) => signal.label === "La latencia empieza a subir"));
  assert.ok(english.signals.some((signal) => signal.label === "Latency starts to climb"));
  assert.ok(english.stages[4].reasons.some((reason) => /^errors \d/.test(reason)), english.stages[4].reasons.join(" | "));
  assert.ok(english.stages[4].reasons.some((reason) => /dropped$/.test(reason)));
  assert.ok(!english.stages.flatMap((item) => item.reasons).some((reason) => /errores|descartadas|sobre la base|del límite/.test(reason)));
  assert.equal(healthLabel("degrading", "en"), "Degrading");
  assert.equal(healthLabel("broken"), "Roto");
  assert.equal(HEALTH.healthy.label, "Sano");
});
