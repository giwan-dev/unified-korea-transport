"""게임을 헤드리스 크롬으로 열어 여러 해를 진행하며 해마다 상태·콘솔 오류를 기록한다 (10단계 QA).

  python tools/serve.py 8743   # 다른 창에서
  .venv/Scripts/python tools/qa_play.py --years 10 --shots out/   # websocket-client 필요

해마다: 연도, 예산, 부채, 지지율, 통합도, 지역 간 통행·철도·도로, 진행 중·완공 사업 수, 콘솔 오류.
첫해에는 계획 사업(경의선 남북 연결 복원 등)을 몇 개 착공해 공사·완공·개통 흐름도 지나가게 한다.
--shots 폴더를 주면 처음과 끝, 그리고 --at으로 준 곳(경도,위도,배율)의 지도 화면을 PNG로 남긴다.
"""
import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


class Page:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=900, suppress_origin=True)
        self.n = 0
        self.errors = []

    def send(self, method, **params):
        self.n += 1
        mid = self.n
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("method") == "Runtime.exceptionThrown":
                d = m["params"]["exceptionDetails"]
                self.errors.append((d.get("exception", {}).get("description") or d.get("text", ""))[:300])
            elif m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] in ("error", "assert"):
                self.errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in m["params"]["args"])[:300])
            if m.get("id") == mid:
                return m.get("result", {})

    def js(self, expr, timeout_ms=600000):
        r = self.send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True, timeout=timeout_ms)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("exception", {}).get("description", r["exceptionDetails"]))
        return r.get("result", {}).get("value")

    def shot(self, path):
        data = self.send("Page.captureScreenshot", format="png")["data"]
        Path(path).write_bytes(base64.b64decode(data))


WAIT_READY = """(async () => {
  for (let k = 0; k < 240; k++) {
    const b = document.querySelector('#btn-next');
    if (window.ukt && b && !b.disabled) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})()"""

STATE = """(() => {
  const s = ukt.state, r = ukt.result;
  return { year: s.year, budget: Math.round(s.budget), debt: Math.round(s.debt), approval: +s.approval.toFixed(1),
    integration: +(s.integration * 100).toFixed(1),
    trips: r ? Math.round(r.totals.trips) : null, rail: r ? Math.round(r.totals.rail) : null, road: r ? Math.round(r.totals.road) : null,
    building: s.projects.filter((p) => p.status === 'building').length, done: s.projects.filter((p) => p.status === 'done').length,
    services: (s.services || []).length, log0: (s.log || []).slice(0, 3) };
})()"""

NEXT_YEAR = """(async () => {
  window.confirm = () => true; window.alert = (m) => { (window.__alerts ||= []).push(String(m)); };
  const y0 = ukt.state.year, t0 = performance.now();
  document.querySelector('#btn-next').click();
  for (let k = 0; k < 1200; k++) {
    await new Promise((r) => setTimeout(r, 500));
    const b = document.querySelector('#btn-next');
    if (ukt.state.year !== y0 && b && !b.disabled) return Math.round((performance.now() - t0) / 100) / 10;
  }
  return -1;
})()"""

START_PLANS = """(async () => {
  window.confirm = () => true; window.alert = (m) => { (window.__alerts ||= []).push(String(m)); };
  const started = [];
  for (const id of %s) {
    [...document.querySelectorAll('button, [role=tab]')].find((b) => b.innerText.trim() === '건설')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const b = document.querySelector(`[data-plan="${id}"]`);
    if (!b || b.disabled) continue;
    b.click();
    await new Promise((r) => setTimeout(r, 1500));
    const ok = document.querySelector('#draft-ok');
    if (ok && !ok.disabled) { ok.click(); await new Promise((r) => setTimeout(r, 800)); started.push(id); }
    else document.querySelector('#draft-cancel')?.click();
  }
  return started;
})()"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8743/")
    ap.add_argument("--years", type=int, default=10)
    ap.add_argument("--plans", default="restore-gyeongui,restore-donghae,gyeongui-expwy")
    ap.add_argument("--shots", default="")
    ap.add_argument("--at", action="append", default=[], help="경도,위도,배율 (지도 화면을 남길 곳)")
    ap.add_argument("--port", type=int, default=9333)
    args = ap.parse_args()
    prof = tempfile.mkdtemp(prefix="ukt-qa-")
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={args.port}", f"--user-data-dir={prof}",
                               "--window-size=1400,900", "--no-first-run",
                               "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling",
                               "--disable-renderer-backgrounding", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json").read())
                break
            except Exception:
                time.sleep(0.2)
        tab = next(t for t in tabs if t["type"] == "page")
        p = Page(tab["webSocketDebuggerUrl"])
        p.send("Runtime.enable"); p.send("Page.enable")
        p.send("Page.navigate", url=args.url)
        t0 = time.time()
        ready = p.js(WAIT_READY)
        print(json.dumps({"ready": ready, "load_s": round(time.time() - t0, 1)}, ensure_ascii=False), flush=True)
        if not ready:
            print("errors", p.errors, "perf", p.js("JSON.stringify(window.__perf || [])"),
                  "text", p.js("document.body.innerText.slice(0, 400)"))
            if args.shots:
                Path(args.shots).mkdir(parents=True, exist_ok=True)
                p.shot(Path(args.shots) / "not_ready.png")
            return 1
        shots = Path(args.shots) if args.shots else None
        if shots:
            shots.mkdir(parents=True, exist_ok=True)

        def snap(tag):
            if not shots:
                return
            p.shot(shots / f"{tag}_overview.png")
            for k, at in enumerate(args.at):
                x, y, z = map(float, at.split(","))
                p.js(f"ukt.map.jumpTo({{center:[{x},{y}],zoom:{z}}}); new Promise((r) => ukt.map.once('idle', () => r(1)))")
                p.shot(shots / f"{tag}_at{k}.png")
            p.js("ukt.map.jumpTo({center:[127.5,37.5],zoom:5.6}); new Promise((r) => ukt.map.once('idle', () => r(1)))")
        snap("start")
        print(json.dumps({"state": p.js(STATE)}, ensure_ascii=False), flush=True)
        plans = [x for x in args.plans.split(",") if x]
        if plans:
            print(json.dumps({"started": p.js(START_PLANS % json.dumps(plans))}, ensure_ascii=False), flush=True)
        for _ in range(args.years):
            n_err = len(p.errors)
            secs = p.js(NEXT_YEAR)
            st = p.js(STATE)
            st["secs"] = secs
            st["new_errors"] = p.errors[n_err:]
            st["alerts"] = p.js("(window.__alerts || []).splice(0)")
            st["perf"] = p.js("(() => { const a = window.__perf || []; const i = a.map((x) => x[0]).lastIndexOf('y: start'); return a.slice(i).map(([n, t]) => n + ' ' + t); })()")
            print(json.dumps(st, ensure_ascii=False), flush=True)
            if secs < 0:
                break
        snap("end")
        print(json.dumps({"total_errors": len(p.errors), "errors": p.errors[:20]}, ensure_ascii=False), flush=True)
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)   # 임시 크롬 프로필 (남기면 실행마다 수십 MB씩 쌓인다)
    return 0


if __name__ == "__main__":
    sys.exit(main())
