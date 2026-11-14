"""Totals per run from the JSON results run.sh keeps: sum.py <out-dir> ['<label>-*']"""
import glob, json, os, sys
out = sys.argv[1]; pat = sys.argv[2] if len(sys.argv) > 2 else '*'
tot = {}
for f in sorted(glob.glob(os.path.join(out, pat + '.json'))):
    name = os.path.basename(f)[:-5]
    try: d = json.load(open(f))
    except ValueError: print(f'{name:30} no result'); continue
    u = d.get('usage', {})
    t = sum(u.get(k, 0) for k in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'))
    print(f"{name:30} tokens={t:8} out={u.get('output_tokens', 0):6} turns={d.get('num_turns'):3} cost=${d.get('total_cost_usd', 0):.2f} {','.join(d.get('modelUsage', {}))}")
    label = name.split('-dybs-')[0]; a = tot.setdefault(label, [0, 0, 0.0])
    a[0] += t; a[1] += d.get('num_turns') or 0; a[2] += d.get('total_cost_usd', 0)
for label, (t, n, c) in tot.items(): print(f'TOTAL {label:24} tokens={t:8} turns={n:3} cost=${c:.2f}')
