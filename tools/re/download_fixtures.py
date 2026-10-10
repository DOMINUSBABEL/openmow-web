import os
import posixpath
import urllib.request
import json
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(HERE, '..', '..', 'web', 'test', 'fixtures'))
os.makedirs(OUT_DIR, exist_ok=True)

from mission_census import SCOPE

def main():
    print(f"Downloading {len(SCOPE)} mission fixtures into {OUT_DIR}...")
    for m in SCOPE:
        name = posixpath.basename(m)
        out_file = os.path.join(OUT_DIR, f"{name}.json")
        url = f"http://127.0.0.1:8080/conv/sdl/{m}/0.mi.json"
        if not os.path.exists(out_file):
            print(f"Fetching {name} from {url}...")
            with urllib.request.urlopen(url) as res:
                content = res.read()
            with open(out_file, 'wb') as f:
                f.write(content)
            print(f"  Saved {name}.json ({len(content)} bytes)")
        else:
            print(f"  {name}.json exists ({os.path.getsize(out_file)} bytes)")
    print("Done downloading fixtures!")

if __name__ == '__main__':
    main()
