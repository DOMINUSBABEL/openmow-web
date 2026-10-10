"""Explore EANM animation format."""
import sys, zipfile, struct, collections, random
sys.stdout.reconfigure(encoding='utf-8')
R = r'C:\Program Files (x86)\Steam\steamapps\common\Men of War Assault Squad 2\resource'
g = zipfile.ZipFile(R + r'\gamelogic.pak')
anms = [n for n in g.namelist() if n.endswith('.anm')]
for n in anms[:2] + ['properties/animation/human/' + x for x in ('run.anm', 'stand.anm') if 'properties/animation/human/' + x in g.namelist()]:
    d = g.read(n)
    print('\n###', n, len(d))
    print(d[:200].hex(' '))
# chunk tags census
tags = collections.Counter(); vers = collections.Counter()
random.seed(2)
for n in random.sample(anms, 200):
    d = g.read(n)
    vers[d[4:8].hex()] += 1
    i = 8
    while i < len(d) - 4:
        t = d[i:i+4]
        if t.isalpha() and t.isupper():
            tags[t] += 1
        i += 1
print('\nversions', vers.most_common(5))
print('tag-like', tags.most_common(15))
