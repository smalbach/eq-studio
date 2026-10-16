import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { baseUrlOf, documentKind, parseDocument, readImportFiles } from "../src/lib/project-documents.ts";
import { parsePostmanEnvironment } from "../src/lib/postman-environment.mjs";

const fixture = (name) => readFileSync(new URL(`../../../packages/runner-core/test/fixtures/${name}`, import.meta.url), "utf8");

test("every accepted document is recognized, in JSON or YAML", () => {
  assert.equal(documentKind(parseDocument(fixture("store.openapi31.json"))), "openapi");
  assert.equal(documentKind(parseDocument(fixture("petstore.swagger2.json"))), "swagger");
  assert.equal(documentKind(parseDocument("swagger: '2.0'\ninfo: { title: x, version: '1' }\npaths: {}\n")), "swagger");
  assert.equal(documentKind(parseDocument(fixture("store.postman_collection.json"))), "postman");
  assert.equal(documentKind(parseDocument(fixture("store.postman_environment.json"))), "postman-environment");
  assert.equal(documentKind({ format: "endpoint-quality/project" }), "project");
  assert.equal(documentKind({ hello: "world" }), null);
});

test("the base URL comes from the converted contract, or from a Postman environment's variables", () => {
  assert.equal(baseUrlOf(JSON.parse(fixture("petstore.swagger2.json"))), "https://petstore.example.com/v2");
  const collection = JSON.parse(fixture("store.postman_collection.json"));
  assert.equal(baseUrlOf(collection), "http://127.0.0.1:4010");
  assert.equal(baseUrlOf(collection, undefined, { baseUrl: "https://staging.example.com" }), "https://staging.example.com");
});

test("a collection and its environment chosen together: the contract, and where the API runs", async () => {
  const files = [new File([fixture("store.postman_environment.json")], "store.postman_environment.json"), new File([fixture("store.postman_collection.json")], "store.postman_collection.json")];
  const { contract, environment } = await readImportFiles(files, "en");
  assert.equal(contract?.kind, "postman");
  assert.deepEqual(environment, { name: "Staging", baseUrl: "https://staging.example.com", variables: { baseUrl: "https://staging.example.com" } });
  await assert.rejects(readImportFiles([new File(["{\"hello\":1}"], "x.json")], "en"), /x\.json: not an OpenAPI 3/);
});

test("a collection dropped on the environment panel points at the project import", () => {
  assert.throws(() => parsePostmanEnvironment(fixture("store.postman_collection.json"), "x", "en"), /import it as a contract/);
});
