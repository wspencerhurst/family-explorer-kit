"""Progress of the notable-cousin portrait download (scripts/fetch_wd_kin_portraits.py).
Usage: python scripts/portrait_status.py"""
import json, pathlib, time, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site/public/portraits/kin"
D = json.loads((ROOT / "data/notable-kin-wd.json").read_text(encoding="utf-8"))
want = {k["qid"] for k in D if k.get("image") and k.get("qid")}
files = sorted(OUT.glob("Q*.jpg"), key=lambda p: p.stat().st_mtime)
have = sum(1 for p in files if p.stem in want)
total = len(want)
bar = 30
fill = round(bar * have / total) if total else bar
print(f"Cousin portraits  [{'#' * fill}{'.' * (bar - fill)}]  {have} / {total}  ({100 * have / max(total, 1):.0f}%)")
if files:
    last = files[-1].stat().st_mtime
    ago = (time.time() - last) / 60
    hour = [p for p in files if p.stat().st_mtime > time.time() - 3600]
    print(f"Last portrait saved {ago:.0f} min ago; {len(hour)} in the past hour.")
    if len(hour) >= 2 and have < total:
        rate = len(hour) / 3600
        eta = datetime.datetime.now() + datetime.timedelta(seconds=(total - have) / rate)
        print(f"At this pace, all done around {eta:%a %I:%M %p} (Wikimedia throttling makes this rough).")
    if ago > 20:
        print("Nothing new in 20+ minutes: the download is probably stopped or heavily throttled.")
