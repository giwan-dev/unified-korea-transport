"""도구 페이지(tools/*.html)를 헤드리스 크롬으로 열어 제목이 '완료'가 될 때까지 기다린 뒤 #log를 출력한다.

  .venv/Scripts/python tools/run_page.py "http://localhost:8743/tools/bench.html?mode=setup"
"""
import json
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])
from qa_play import CHROME, Page  # noqa: E402


def main(url, port=9335):
    prof = tempfile.mkdtemp(prefix="ukt-page-")
    ch = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                           "--disable-background-timer-throttling", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json").read())
                break
            except Exception:
                time.sleep(0.2)
        p = Page(next(t for t in tabs if t["type"] == "page")["webSocketDebuggerUrl"])
        p.send("Runtime.enable")
        p.send("Page.navigate", url=url)
        t0 = time.time()
        print(p.js("(async()=>{for(let k=0;k<3000;k++){if(document.title==='완료')break;await new Promise(r=>setTimeout(r,500));}"
                   "return document.querySelector('#log')?.textContent})()"), f"({round(time.time() - t0)}s)", p.errors[:5])
    finally:
        ch.terminate()


if __name__ == "__main__":
    main(sys.argv[1])
