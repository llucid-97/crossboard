import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const outputRoot = new URL("../out/", import.meta.url);

test("exports a complete GitHub Pages entry point", async () => {
  const html = await readFile(new URL("index.html", outputRoot), "utf8");

  assert.match(
    html,
    /<title>Crossboard — four-player chess, peer to peer<\/title>/i,
  );
  assert.match(html, /\/crossboard\/_next\/static\//);
  assert.match(html, /https:\/\/llucid-97\.github\.io\/crossboard\/og\.png/);
  const rootReferences = [
    ...html.matchAll(/(?:href|src)="(\/[^"]*)"/g),
  ].map((match) => match[1]);
  assert.ok(
    rootReferences.every(
      (reference) =>
        reference === "/crossboard/" ||
        reference.startsWith("/crossboard/"),
    ),
    `Found an unprefixed root URL: ${rootReferences.join(", ")}`,
  );
  await Promise.all(
    [...new Set(rootReferences)].map((reference) => {
      const relativePath =
        reference === "/crossboard/"
          ? "index.html"
          : reference.slice("/crossboard/".length);
      return access(new URL(relativePath, outputRoot));
    }),
  );
  await access(new URL("og.png", outputRoot));
  await access(new URL("_next/static/", outputRoot));
  await access(new URL(".nojekyll", outputRoot));
});
