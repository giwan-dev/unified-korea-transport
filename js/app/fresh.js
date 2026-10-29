// 가장 먼저 실행되는 모듈 (main.js의 첫 import, 다른 모듈을 가져오지 않는다): 다른 모듈이 자료를 받기 전에 fetch를 감싼다.
// 게임 자료(data/…)는 받을 때마다 서버에 바뀌었는지 묻는다 (바뀌지 않았으면 304라 거의 받지 않는다).
// 크롬이 국외 거점 자료(air_sea.json)를 예전 것으로 캐시에서 쓰면 기본 노드 수가 달라져 저장 게임의 새 노드 번호가 밀렸다
{
  const raw = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (url, opt) => (typeof url === 'string' && /^(\.\.\/)?data\//.test(url) && !opt?.cache ? raw(url, { ...opt, cache: 'no-cache' }) : raw(url, opt));
}
