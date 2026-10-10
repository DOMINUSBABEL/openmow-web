import json, struct, sys, urllib.request
url = sys.argv[1]
d = urllib.request.urlopen(url).read()
jl, = struct.unpack_from('<I', d, 12)
g = json.loads(d[20:20 + jl])
print('images', g.get('images'))
for m in g.get('materials', []):
    print('MAT', m['name'], m.get('alphaMode'), json.dumps(m['extras'])[:300])
def walk(i, depth=0):
    n = g['nodes'][i]
    mesh = n.get('mesh')
    mn = g['meshes'][mesh]['name'] if mesh is not None else ''
    print('  ' * depth + n.get('name', '?'), mn, n.get('extras', ''))
    for c in n.get('children', []):
        walk(c, depth + 1)
walk(0)
