# Temporary (#277): appends each run's largest task CPU time after Propose to
# $T277_OUT, so the stress run reports the spread as well as the failures.
p = 'packages/cli/test/add-structure-big-map.test.ts'
s = open(p).read()
a = '          assert.isNotEmpty(tasks, "the trace\'s main-thread tasks");'
assert a in s
s = s.replace('import { pipelineMap, shapesMap } from "./fixtures.ts";', 'import { appendFileSync } from "node:fs";\nimport { pipelineMap, shapesMap } from "./fixtures.ts";', 1)
s = s.replace(a, 'appendFileSync(process.env.T277_OUT ?? "", `${JSON.stringify({ label, cpu: Math.round(Math.max(0, ...tasks)) })}\\n`);\n' + a, 1)
open(p, 'w').write(s)
