/**
 * What every bundle of the API shares — the CLI's (`bundle.mjs`) and the desktop app's
 * (`apps/desktop/scripts/build.mjs`).
 *
 * The modules marked external are optional drivers and transports TypeORM and NestJS load on
 * demand and this product never uses; leaving them out is what keeps a bundle self-contained.
 */
export const OPTIONAL = [
  "@nestjs/microservices", "@nestjs/microservices/*", "@nestjs/websockets", "@nestjs/websockets/*", "@nestjs/platform-socket.io",
  "class-validator", "class-transformer", "class-transformer/*", "@fastify/static", "@fastify/view", "cache-manager",
  "mysql", "mysql2", "oracledb", "mssql", "sqlite3", "better-sqlite3", "react-native-sqlite-storage", "@sap/hana-client", "@sap/hana-client/*", "hdb-pool",
  "mongodb", "pg-native", "pg-query-stream", "typeorm-aurora-data-api-driver", "@google-cloud/spanner", "redis", "@capacitor-community/sqlite", "expo-sqlite", "nativescript-sqlite", "sql.js/dist/sql-wasm-debug.js",
  "msgpackr-extract", "kerberos", "@mongodb-js/zstd", "snappy", "socks", "aws4", "mongodb-client-encryption", "gcp-metadata",
  "ts-node",
];

/**
 * Some editor extensions (a "console" helper, for one) patch packages in the local store with a
 * `/* build-hook-start *\/ … /* build-hook-end *\/` block that loads code from the developer's
 * home directory. It never belongs in what ships: the bundle drops those blocks, so it is the
 * same on any machine.
 */
export const stripDevHooks = {
  name: "strip-dev-hooks",
  setup(builder) {
    builder.onLoad({ filter: /node_modules[\\/].*\.(c|m)?js$/ }, async ({ path }) => {
      const { readFile } = await import("node:fs/promises");
      const source = await readFile(path, "utf8");
      if (!source.includes("build-hook-start")) return undefined;
      return { contents: source.replace(/\/\* build-hook-start \*\/[\s\S]*?\/\* build-hook-end \*\//g, ""), loader: "js" };
    });
  },
};
