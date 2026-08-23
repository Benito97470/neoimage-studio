import assert from "node:assert/strict";
import test from "node:test";

test("renders NeoImage Studio metadata and product surface", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>NeoImage Studio/);
  assert.match(html, /Studio de création IA/);
  assert.match(html, /GPT Image 1\.5/);
  assert.match(html, /Qualité de sortie/);
  assert.match(html, />4K</);
  assert.match(html, /Historique/);
  assert.match(html, /Nouveau/);
  assert.match(html, /Compte NeoImage/);
  assert.match(html, /historique synchronisé privé/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("protects synchronized history behind authenticated identity", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("history-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const response = await worker.fetch(
    new Request("http://localhost/api/history", { headers: { accept: "application/json" } }),
    env,
    ctx,
  );

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.match(payload.signInUrl, /^\/signin-with-chatgpt\?/);
});

test("validates model and resolution compatibility before provider calls", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const invalidModel = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", model: "unknown-image-model", apiKey: "test", prompt: "test" }),
    }),
    env,
    ctx,
  );
  assert.equal(invalidModel.status, 400);
  assert.match(await invalidModel.text(), /Modèle OpenAI non pris en charge/);

  const incompatibleResolution = await worker.fetch(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        model: "gemini-3.1-flash-lite-image",
        apiKey: "test",
        prompt: "test",
        resolution: "4K",
      }),
    }),
    env,
    ctx,
  );
  assert.equal(incompatibleResolution.status, 400);
  assert.match(await incompatibleResolution.text(), /limité au 1K/);
});

test("protects NeoImage account creation behind authenticated identity", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("account-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const response = await worker.fetch(
    new Request("http://localhost/api/account", { headers: { accept: "application/json" } }),
    env,
    ctx,
  );

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.authenticated, false);
  assert.match(payload.signInUrl, /^\/signin-with-chatgpt\?/);
});
