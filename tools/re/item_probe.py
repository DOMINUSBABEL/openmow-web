import os, sys, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
from vfs import VFS  # noqa
vfs = VFS()
names = ['morphine', 'johnson_m1941', 'm24x5', 'pwm1', 'satchel', 'valter', 'b33r', 'winterhat', 'tank_cap2_ger', 'pistol', 'bullet75']
for n in names:
    hits = [f for f in vfs.files if re.search(r'(^|/)' + re.escape(n) + r'(\.|$)', f)]
    print(n, hits[:6])
# where are inventory items declared? look for a text file containing '"morphine"' in set/
cnt = 0
for f in vfs.files:
    if f.startswith('/set/') and (f.endswith('.set') or f.endswith('.inc') or f.endswith('.ext')):
        try:
            d = vfs.read(f)
        except Exception:
            continue
        if b'morphine' in d:
            print('mention', f); cnt += 1
            if cnt > 12: break
print([f for f in vfs.files if f.startswith('/set/') and '/' not in f[5:]][:80])
