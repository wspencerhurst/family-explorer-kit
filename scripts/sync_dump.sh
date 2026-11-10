#!/bin/sh
# Move the newest FS crawl export from Downloads into data/raw/fs-tree-dump-latest.json.
# The built-in browser sometimes leaves downloads as GUID-named *.tmp files, so those are recognized by content.
cd "$(dirname "$0")/.."
python - "$HOME/Downloads" <<'EOF'
import os, sys, glob, shutil
dl = sys.argv[1]
c = glob.glob(os.path.join(dl, "fs-tree-dump*.json")) + glob.glob(os.path.join(dl, "*.tmp"))
dumps = []
for f in c:
    try:
        with open(f, encoding="utf-8") as fh:
            if fh.read(12).startswith('{"crawled"'):
                dumps.append(f)
    except Exception:
        pass
if not dumps:
    print("no crawl export in Downloads"); sys.exit()
dumps.sort(key=os.path.getmtime)
import json
n = len(json.load(open(dumps[-1], encoding="utf-8"))["persons"])
dest = "data/raw/fs-tree-dump-%s.json" % __import__("time").strftime("%Y%m%d-%H%M")
shutil.move(dumps[-1], dest)
for f in dumps[:-1]:
    os.remove(f)
print("synced %s (%d persons)" % (dest, n))
EOF
