# Temporary (#277): one line per run, then every task over 50 ms after
# Propose with what ran in it (long-animation-frame script attribution and
# the CPU profile's split by category).
import json, sys, collections
CATS = [
  ('scene/route/fit', ('sceneOf', 'routeRevealed', 'routesOf', 'fittedViewOf', 'fitFloorOf', 'lash', 'placeLabels', 'drawWant', 'routeVertices', 'routeCorners')),
  ('react render', ('renderRootSync', 'renderRootConcurrent')),
  ('react commit', ('commitRoot',)),
  ('react effects', ('flushPassiveEffects',)),
]
def profile_runs(prof, shift):
    nodes = {n['id']: n for n in prof['nodes']}
    parent = {c: n['id'] for n in prof['nodes'] for c in n.get('children', [])}
    name = lambda i: nodes[i]['callFrame']['functionName'] or '(anon)'
    times = []; t = prof['startTime']
    for dt in prof['timeDeltas']:
        t += dt; times.append(t)
    end = times[-1] if times else 0
    runs = []; cur = []
    for s, tm in zip(prof['samples'], times):
        if name(s) == '(idle)':
            if cur: runs.append(cur); cur = []
        else: cur.append((s, tm))
    if cur: runs.append(cur)
    out = []
    for r in runs:
        start = (r[0][1] - end) / 1000 + shift
        dur = (r[-1][1] - r[0][1]) / 1000
        if dur < 40: continue
        cats = collections.Counter()
        for s, _ in r:
            names = []; i = s
            while i is not None:
                names.append(name(i)); i = parent.get(i)
            cat = next((c for c, keys in CATS if any(any(k in nm for k in keys) for nm in names)), 'gc' if names[0] == '(garbage collector)' else 'other')
            cats[cat] += 1
        out.append((start, dur, ', '.join(f"{c} {100*v//len(r)}%" for c, v in cats.most_common())))
    return out
rows = [json.loads(l) for l in open(sys.argv[1])]
limit = 200
fails = [d for d in rows if d['longest'] > limit]
for label in sorted({d['label'] for d in rows}):
    ls = sorted(d['longest'] for d in rows if d['label'] == label)
    print(f"case {label!r}: {len(ls)} runs, longest after Propose min {ls[0]} median {ls[len(ls)//2]} max {ls[-1]}, over {limit}: {sum(1 for x in ls if x > limit)}")
for d in rows:
    p = d['p']
    print(f"== {d['label']!r} longest {d['longest']}{'  FAIL' if d['longest'] > limit else ''}  tasks over 30 ms [wall, cpu] {d.get('cpu')}")
    marks = [(m['at'] - p, m['what']) for m in d['marks'] if m['at'] >= p]
    print('   marks:', [(t, w[:34]) for t, w in marks][:7])
    runs = profile_runs(d['prof'], d['now'] - p) if d.get('prof') else []
    for a, dur in d['long']:
        t = a - p
        if t < 0 or dur < 50: continue
        loaf = [f for f in d['loafs'] if f['at'] - p <= t + 5 and f['at'] + f['dur'] - p >= t + dur - 5]
        scripts = [(s['inv'][:30], s['dur']) for f in loaf for s in f['scripts'] if s['dur'] >= 10]
        prof = [f"{c}" for st, du, c in runs if st < t + dur and st + du > t]
        print(f"   task {t:+6d} ms {dur:4d} ms  scripts {scripts}  profile [{' | '.join(prof)}]")
