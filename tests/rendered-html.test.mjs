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
  assert.match(html, /Google, Microsoft, Apple ou SSO/);
  assert.match(html, /Connexion sécurisée par ChatGPT/);
  assert.match(html, /Coffre synchronisé/);
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

test("uses a local test account instead of the hosted sign-in route on localhost", async () => {
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
  assert.equal(payload.authMode, "local");
  assert.match(payload.signInUrl, /^\/api\/local-auth\?/);
});

test("keeps the hosted ChatGPT sign-in route outside localhost", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("hosted-account-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const response = await worker.fetch(
    new Request("https://neoimage.example/api/account", { headers: { accept: "application/json" } }),
    env,
    ctx,
  );

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.authMode, "social");
  assert.match(payload.signInUrl, /^\/signin-with-chatgpt\?/);
});

test("creates the local development session without exposing it on production hosts", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("local-auth-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const localResponse = await worker.fetch(
    new Request("http://localhost/api/local-auth?return_to=%2F%3Ftab%3Dhistory"),
    env,
    ctx,
  );
  assert.equal(localResponse.status, 303);
  assert.match(localResponse.headers.get("set-cookie") || "", /neoimage_local_session=1/);
  assert.equal(localResponse.headers.get("location"), "http://localhost/?tab=history");

  const hostedResponse = await worker.fetch(
    new Request("https://neoimage.example/api/local-auth"),
    env,
    ctx,
  );
  assert.equal(hostedResponse.status, 404);
});

test("protects the synchronized API vault behind authenticated identity", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("vault-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const response = await worker.fetch(
    new Request("http://localhost/api/vault", { headers: { accept: "application/json" } }),
    env,
    ctx,
  );

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.match(payload.signInUrl, /^\/signin-with-chatgpt\?/);
});

test("normalizes provider safety blocks without exposing the raw technical error", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("safety-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    if (String(input).includes("api.openai.com/v1/images/generations")) {
      return new Response(JSON.stringify({ error: { message: "safety_violations=[sexual]" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-image-2",
          apiKey: "test-key",
          prompt: "portrait éditorial",
          aspectRatio: "1:1",
          resolution: "1K",
          quality: "medium",
        }),
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, "PROVIDER_SAFETY_BLOCK");
    assert.match(payload.error, /classement est automatique/);
    assert.doesNotMatch(payload.error, /safety_violations/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
