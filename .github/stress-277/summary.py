# Temporary (#277): per case, the run count, the CPU time spread and the runs over the limit.
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
for label in sorted({r['label'] for r in rows}):
    xs = sorted(r['cpu'] for r in rows if r['label'] == label)
    print(f"case {label!r}: {len(xs)} runs, most CPU in one task after Propose: min {xs[0]} median {xs[len(xs)//2]} max {xs[-1]} ms, over 200: {sum(x > 200 for x in xs)}")
