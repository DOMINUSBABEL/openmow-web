import sys
sys.path.insert(0, 'tools/server')
from vfs import VFS
import formats.gem_pre as gp
from test_pre_fix import fixed_call_args, fixed_expand

gp.Pre._call_args = fixed_call_args
gp.Pre._expand = fixed_expand

vfs = VFS()
p = gp.Pre(vfs)
items = p.load('/entity/-vehicle/tank_light/wespe/wespe.def')
print("Total items:", len(items))

# Let's inspect boarder in wespe
for it in items:
    if hasattr(it, 'find_all'):
        for b in it.find_all('boarder'):
            for c in b.items:
                print("  boarder item:", c)
