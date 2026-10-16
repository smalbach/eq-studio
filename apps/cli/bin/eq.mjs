#!/usr/bin/env node
// The published entry point: the bundled CLI, API and web app in `dist/`.
import { createRequire } from "node:module";

createRequire(import.meta.url)("../dist/eq.cjs");
