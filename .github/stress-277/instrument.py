# Temporary (#277): adds long-animation-frame attribution, worker ask/answer
# marks and a CPU profile from Propose on to the Propose long-task cases, and
# writes one JSON line per run to $T277_OUT.
import sys
p = 'packages/cli/test/add-structure-big-map.test.ts'
s = open(p).read()
def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)
rep('import { pipelineMap, shapesMap } from "./fixtures.ts";', '''import { appendFileSync, readFileSync } from "node:fs";
import { pipelineMap, shapesMap } from "./fixtures.ts";
const instr = readFileSync(process.env.T277_INSTR ?? "", "utf8");
const t277Out = process.env.T277_OUT ?? "";''')
rep('''          const { errors, page, url } = yield* served(
            pipeline,
            recordLongTasks
          );''', '''          const { errors, page, url } = yield* served(
            pipeline,
            recordLongTasks + instr
          );
          const cdp = yield* Effect.promise(() => page.context().newCDPSession(page));
          const profiling = process.env.T277_PROFILE === "1";''')
rep('''          yield* inPage(page, "globalThis.proposedAt = performance.now()");''', '''          if (profiling) {
            yield* Effect.promise(() => cdp.send("Profiler.enable"));
            yield* Effect.promise(() => cdp.send("Profiler.setSamplingInterval", { interval: 1000 }));
            yield* Effect.promise(() => cdp.send("Profiler.start"));
          }
          yield* inPage(page, "globalThis.proposedAt = performance.now()");''')
rep('''          const longest = yield* inPage<number>(''', '''          const prof = profiling ? (yield* Effect.promise(() => cdp.send("Profiler.stop"))).profile : null;
          const dump = yield* inPage<string>(
            page,
            "JSON.stringify({ p: Math.round(globalThis.proposedAt), now: Math.round(performance.now()), long: globalThis.longTasks.map(({ at, duration }) => [Math.round(at), Math.round(duration)]), marks: globalThis.marks, loafs: globalThis.loafs })"
          );
          const longest = yield* inPage<number>(''')
rep('''          assert.isAtMost(
            Math.round(longest),
            proposeTaskMillis,''', '''          appendFileSync(t277Out, `${JSON.stringify({ label, longest: Math.round(longest), ...JSON.parse(dump), prof })}\\n`);
          assert.isAtMost(
            Math.round(longest),
            proposeTaskMillis,''')
open(p, 'w').write(s)
