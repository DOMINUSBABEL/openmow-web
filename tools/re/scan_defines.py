import sys, re
sys.path.insert(0, 'tools/server')
from vfs import VFS
vfs = VFS()

# Find all macro definitions in /properties/ and /set/ and see what %vars they use
for f in vfs.files:
    if f.startswith('/properties/') or f.startswith('/set/'):
        if f.endswith('.ext') or f.endswith('.inc') or f.endswith('.set'):
            d = vfs.read(f)
            # Find (define ... )
            for m in re.finditer(rb'\(define\s+"?([\w\-]+)"?(.*?)\n\)', d, re.S):
                name = m.group(1).decode('latin1')
                body = m.group(2).decode('latin1', 'replace')
                pcts = set(re.findall(r'%(\w+)', body))
                if pcts:
                    # check if any have default values or special syntax
                    if any('=' in p or ':' in p or '?' in p for p in pcts):
                        print("Special pct:", name, pcts)
print("Scan done.")
