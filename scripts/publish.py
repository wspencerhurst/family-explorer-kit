"""Publish the Family Explorer to your domain (family.config.json "domain").

Commits everything and pushes to GitHub; Cloudflare Pages then builds and deploys within a couple of minutes.

  python scripts/publish.py                 # commit + push what has changed
  python scripts/publish.py --rebuild       # first rerun the data pipeline (merge -> summaries -> consanguinity -> site data)
  python scripts/publish.py -m "message"    # custom commit message
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import os, subprocess, sys, pathlib, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}


def run(*cmd, cwd=ROOT, check=True):
    print("$", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, env=ENV, check=check, shell=(os.name == "nt" and cmd[0] == "npx"))


def main():
    args = sys.argv[1:]
    msg = args[args.index("-m") + 1] if "-m" in args else f"Update {datetime.date.today().isoformat()}"
    if "--rebuild" in args:
        for s in ("merge.py", "build_summaries.py", "consanguinity.py", "build_site_data.py"):
            run(sys.executable, f"scripts/{s}")
    # Same check Cloudflare runs, so a broken build is caught here instead of on deploy.
    run("npx", "tsc", "--noEmit", cwd=ROOT / "site")
    run("git", "add", "-A")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        print("Nothing changed; nothing to publish.")
        return
    run("git", "commit", "-q", "-m", msg)
    run("git", "push")
    print("Pushed. Cloudflare will deploy in a minute or two:", ("https://" + CFG["domain"]) if CFG.get("domain") else "(your Pages URL)")


if __name__ == "__main__":
    main()
