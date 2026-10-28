"""불러오기·해 넘기기·renderAll 시간을 헤드리스 크롬으로 잰다 (경량화 전후 비교용).

  .venv/Scripts/python -I tools/perf_run.py --url http://localhost:8744/ --years 2
  --profile DIR   크롬 프로필을 남긴다(저장 게임을 다음 실행에서 다시 연다)
  --cpu load|settle|render|year CPU 프로파일을 떠서 자기 시간이 큰 함수를 보인다
  --reload        해를 넘긴 뒤 페이지를 다시 열어 저장 게임 불러오기 시간도 잰다
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from collections import defaultdict

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from qa_play import CHROME, Page, NEXT_YEAR  # noqa: E402

READY = """(async () => {
  for (let k = 0; k < 600; k++) {
    const b = document.querySelector('#btn-next');
    if (typeof ukt !== 'undefined' && ukt.result && b && !b.disabled) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
})()"""

RENDER = """(() => { const a = []; for (let k = 0; k < 3; k++) { const t = performance.now(); ukt.renderAll(); a.push(performance.now() - t); }
  return a.map((x) => Math.round(x)); })()"""


class NetPage(Page):
    """Page + 아직 끝나지 않은 네트워크 요청 (불러오기가 멈췄을 때 어디서 멈췄는지 본다)"""

    def __init__(self, ws_url):
        super().__init__(ws_url)
        self.inflight = {}

    def send(self, method, **params):
        self.n += 1
        mid = self.n
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            ev, pr = m.get("method"), m.get("params", {})
            if ev == "Network.requestWillBeSent":
                self.inflight[pr["requestId"]] = pr["request"]["url"].split("/", 3)[-1]
            elif ev in ("Network.loadingFinished", "Network.loadingFailed"):
                u = self.inflight.pop(pr["requestId"], None)
                if ev == "Network.loadingFailed" and u:
                    self.errors.append(f"network failed: {u} {pr.get('errorText')}")
            elif ev == "Runtime.exceptionThrown":
                d = pr["exceptionDetails"]
                self.errors.append((d.get("exception", {}).get("description") or d.get("text", ""))[:300])
            elif ev == "Runtime.consoleAPICalled" and pr["type"] in ("error", "assert"):
                self.errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in pr["args"])[:300])
            if m.get("id") == mid:
                return m.get("result", {})


def top_profile(prof, n=25):
    nodes = {x["id"]: x for x in prof["nodes"]}
    self_t = defaultdict(float)
    dt = prof.get("timeDeltas", [])
    for sid, d in zip(prof.get("samples", []), dt):
        cf = nodes[sid]["callFrame"]
        key = f'{cf["functionName"] or "(anon)"} {cf["url"].split("/")[-1]}:{cf["lineNumber"] + 1}'
        self_t[key] += d / 1000
    return sorted(self_t.items(), key=lambda x: -x[1])[:n]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8744/")
    ap.add_argument("--years", type=int, default=2)
    ap.add_argument("--profile", default="")
    ap.add_argument("--cpu", default="")
    ap.add_argument("--reload", action="store_true")
    ap.add_argument("--settle", type=float, default=1, help="불러온 뒤 첫해를 넘기기 전에 기다릴 초")
    ap.add_argument("--port", type=int, default=9341)
    args = ap.parse_args()
    prof = args.profile or tempfile.mkdtemp(prefix="ukt-perf-")
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={args.port}", f"--user-data-dir={prof}",
                               "--window-size=1400,900", "--no-first-run",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling",
                               "--disable-renderer-backgrounding", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = {}
    try:
        for _ in range(50):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json").read())
                break
            except Exception:
                time.sleep(0.2)
        p = NetPage(next(t for t in tabs if t["type"] == "page")["webSocketDebuggerUrl"])
        p.send("Runtime.enable"); p.send("Page.enable"); p.send("Profiler.enable"); p.send("Network.enable")

        def load(tag):
            if args.cpu == "load":
                p.send("Profiler.setSamplingInterval", interval=500); p.send("Profiler.start")
            t0 = time.time()
            p.send("Page.navigate", url=args.url)
            ok = p.js(READY)
            for _ in range(3):   # 새 판이면 index.html이 파일을 새로 받고 한 번 다시 연다 (기다리던 평가가 끊겨 None)
                if ok is not None:
                    break
                time.sleep(1)
                ok = p.js(READY)
            out[tag] = round(time.time() - t0, 1)
            print(json.dumps({tag: out[tag], "ok": ok}), flush=True)
            if args.cpu == "load":
                for k, v in top_profile(p.send("Profiler.stop")["profile"]):
                    print(f"  {v:8.0f}ms  {k}")
            if not ok:
                return ok
            print("  perf:", p.js("JSON.stringify(ukt.perf.map(([n,t])=>n+' '+t))"), flush=True)
            p.js("document.querySelector('[data-setup-act=ok]')?.click(); 1")
            return ok

        if not load("load_s"):
            print("not ready", p.errors[:10], p.js("JSON.stringify(globalThis.__perf)"), p.js("document.body.innerText.slice(0,300)"))
            # 다 받지 못한 파일 (모듈 그래프가 어디서 멈췄는지)
            print("resources", p.js("JSON.stringify(performance.getEntriesByType('resource').map((e) => e.name.replace(location.origin, '') + ' ' + Math.round(e.duration)).filter((x) => /[.](js|json|bin)/.test(x)).length)"))
            print("pending", json.dumps(sorted(p.inflight.values()), ensure_ascii=False)[:1500])
            return 1
        if args.cpu == "settle":
            p.send("Profiler.setSamplingInterval", interval=1000); p.send("Profiler.start")
        time.sleep(args.settle)
        if args.cpu == "settle":
            for k, v in top_profile(p.send("Profiler.stop")["profile"], 40):
                print(f"  {v:8.0f}ms  {k}")
        if args.cpu == "render":
            p.send("Profiler.setSamplingInterval", interval=200); p.send("Profiler.start")
        r = p.js(RENDER)
        print(json.dumps({"renderAll_ms": r}), flush=True)
        if args.cpu == "render":
            for k, v in top_profile(p.send("Profiler.stop")["profile"], 30):
                print(f"  {v:8.0f}ms  {k}")
        for y in range(args.years):
            if args.cpu == "year" and y == args.years - 1:
                p.send("Profiler.setSamplingInterval", interval=500); p.send("Profiler.start")
            s = p.js(NEXT_YEAR)
            print(json.dumps({"year": p.js("ukt.state.year"), "secs": s}), flush=True)
            print("  perf:", p.js("(() => { const a = ukt.perf; const i = a.map((x) => x[0]).lastIndexOf('y: start'); return a.slice(i).map(([n, t]) => n + ' ' + t).join(' | '); })()"), flush=True)
            if args.cpu == "year" and y == args.years - 1:
                for k, v in top_profile(p.send("Profiler.stop")["profile"]):
                    print(f"  {v:8.0f}ms  {k}")
        r = p.js(RENDER)
        print(json.dumps({"renderAll_ms_after": r}), flush=True)
        if args.reload:
            p.js("new Promise((r) => setTimeout(r, 3000))")
            load("reload_s")
            print(json.dumps({"year_after_reload": p.js("ukt.state.year")}), flush=True)
        print(json.dumps({"errors": p.errors[:20]}, ensure_ascii=False), flush=True)
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            pass
        if not args.profile:
            shutil.rmtree(prof, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
