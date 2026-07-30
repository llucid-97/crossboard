import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Crossboard product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Crossboard — four-player chess and checkers<\/title>/i,
  );
  assert.match(html, /Pick your/i);
  assert.match(html, /Four-player checkers/i);
  assert.match(html, /Practice teams/i);
  assert.match(html, /Practice free-for-all/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("removes the disposable starter and records production metadata", async () => {
  const [
    page,
    layout,
    packageJson,
    appSource,
    networkSource,
    replicationSource,
  ] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(
        new URL("../app/components/CrossboardApp.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/game/network.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/game/replication.ts", import.meta.url), "utf8"),
    ]);

  assert.match(page, /CrossboardApp/);
  assert.match(layout, /Crossboard — four-player chess and checkers/);
  assert.match(packageJson, /"peerjs"/);
  assert.match(appSource, /Undo turn/);
  assert.match(appSource, /runLobbyCommand\(gameRef/);
  assert.match(appSource, /allowOpenSeats=\{isNetworked\}/);
  assert.match(appSource, /You \+ a computer vs two computers/);
  assert.match(appSource, /Your refresh recovery code/);
  assert.match(appSource, /Checking every available recovery chain/);
  assert.match(appSource, /type: "chain-summary"/);
  assert.match(appSource, /setInterval\(shareSummary, 1_500\)/);
  assert.match(appSource, /visibilitychange/);
  assert.match(appSource, /reconnectNow/);
  assert.match(networkSource, /serialization: "binary"/);
  assert.doesNotMatch(networkSource, /serialization: "json"/);
  assert.match(replicationSource, /mergeStateChains/);
  assert.match(replicationSource, /MAX_STATE_CHAIN_ENTRIES = 48/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
