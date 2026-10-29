"""version.json을 만든다: 판 번호와 새 판일 때 캐시를 새로 받을 파일 목록.

iPad Safari 등은 JS 모듈·데이터를 HTTP 캐시에서 오래 쓰기 때문에, 새 판을 올려도 웹사이트 데이터를
지워야 바뀐 것이 보였다. index.html 맨 앞의 작은 스크립트가 version.json을 (캐시 없이) 받아 판 번호가
달라졌으면 이 목록을 다시 받은 뒤 한 번 새로 연다. 판을 올릴 때마다 실행한다.

실행: python tools/stamp_version.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    # 0.5.0부터 판 번호는 js/app/core.js에 있다 (예전 판은 js/main.js)
    src = next(t for p in ("js/app/core.js", "js/main.js") if (ROOT / p).exists() and "const APP_VERSION" in (t := (ROOT / p).read_text(encoding="utf-8")))
    v = re.search(r"const APP_VERSION = '([^']+)'", src).group(1)
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    files = sorted(p.relative_to(ROOT).as_posix() for d in ("js", "css") for p in (ROOT / d).rglob("*") if p.suffix in (".js", ".css"))
    # 시작할 때 받는 큰 데이터 (index.html의 preload). 나머지 data/는 index.html이 받을 때마다 서버에 바뀌었는지 묻게 한다
    files += re.findall(r'<link rel="preload" href="([^"]+)"', html)
    (ROOT / "version.json").write_text(json.dumps({"v": v, "files": files}, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(v, len(files))


if __name__ == "__main__":
    main()
