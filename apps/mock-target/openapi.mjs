/**
 * The OpenAPI 3.1 document of the mock store.
 *
 * The engine validates every response it receives against this document, so it is written to
 * be exact rather than generous: every status an operation can answer is declared, every
 * resource schema is closed (`additionalProperties: false`) and every required member is listed.
 * A document that is looser than the API makes schema assertions pass that should fail.
 *
 * It is the same whether the server enforces authentication or not: the contract describes the
 * API as deployed, and an instance started without `--auth` is a development convenience that
 * the project's environment declares (`authEnabled: false`), not a different contract.
 */

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const problemResponse = (description) => ({ description, content: { "application/problem+json": { schema: ref("Problem") } } });
const json = (schema, description) => ({ description, content: { "application/json": { schema } } });
const parameter = (name) => ({ $ref: `#/components/parameters/${name}` });
const response = (name) => ({ $ref: `#/components/responses/${name}` });

/** A request body with its schema and one named example per case worth showing. */
const body = (schemaName, examples) => ({
  required: true,
  content: { "application/json": { schema: ref(schemaName), examples: Object.fromEntries(Object.entries(examples).map(([name, value]) => [name, { value }])) } },
});

// The API key is accepted everywhere except DELETE: a key embedded in a script should not be
// able to destroy data. Declaring it per operation is what lets a client (and the engine) know
// that a 401 to a DELETE with a valid key is the contract, not a bug.
const READ_WRITE = [{ bearerAuth: [] }, { apiKey: [] }];
const BEARER_ONLY = [{ bearerAuth: [] }];

const listResponses = { 200: null, 401: response("Unauthorized"), 422: response("ValidationError") };

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Mock Store API",
      version: "1.0.0",
      description: "A fictional store used to exercise Endpoint Quality end to end: products with a natural key and a bulk upsert, stores with a geographic filter, nested reviews, cursor pagination and three kinds of credential.",
    },
    tags: [
      { name: "health", description: "Liveness." },
      { name: "products", description: "The catalog. `sku` is the natural key." },
      { name: "reviews", description: "Reviews nested under a product. Their key is answered as `id`." },
      { name: "stores", description: "Physical stores. `name` is the natural key; listable by distance." },
    ],
    security: READ_WRITE,
    paths: {
      "/health": {
        get: {
          operationId: "healthCheck", tags: ["health"], summary: "Liveness probe", security: [],
          responses: { 200: json(ref("Health"), "The service is up.") },
        },
      },
      "/v1/products": {
        get: {
          operationId: "listProducts", tags: ["products"], summary: "List products",
          parameters: [parameter("Limit"), parameter("Cursor"), parameter("Q"), parameter("Category"), parameter("Sku")],
          responses: { ...listResponses, 200: json(ref("ProductList"), "A page of products.") },
        },
        post: {
          operationId: "createProduct", tags: ["products"], summary: "Create a product",
          requestBody: body("ProductCreate", { minimal: { sku: "SKU-1001", name: "Walnut Desk", category: "furniture", price: 249 }, complete: { sku: "SKU-1002", name: "Linen Cushion", category: "textiles", price: 19.5, stock: 12, description: "40 x 40 cm, natural colour." } }),
          responses: { 201: json(ref("ProductEnvelope"), "The created product."), 401: response("Unauthorized"), 403: response("Forbidden"), 409: response("Conflict"), 422: response("ValidationError") },
        },
      },
      "/v1/products/bulk": {
        post: {
          operationId: "bulkUpsertProducts", tags: ["products"], summary: "Create or update products by SKU",
          description: "Each record is matched by `sku`: a new SKU is created, an existing one is updated, and one whose fields already match is left unchanged. The response counts each outcome; it does not return ids.",
          requestBody: body("ProductBulkRequest", { upsert: { records: [{ sku: "SKU-2001", name: "Bamboo Tray", category: "kitchen", price: 14 }] } }),
          responses: { 200: json(ref("BulkResultEnvelope"), "How many records were created, updated or left unchanged."), 401: response("Unauthorized"), 403: response("Forbidden"), 422: response("ValidationError") },
        },
      },
      "/v1/products/{product_id}": {
        parameters: [parameter("ProductId")],
        get: {
          operationId: "getProduct", tags: ["products"], summary: "Read a product",
          responses: { 200: json(ref("ProductEnvelope"), "The product."), 401: response("Unauthorized"), 404: response("NotFound") },
        },
        put: {
          operationId: "replaceProduct", tags: ["products"], summary: "Replace a product",
          description: "Every required field must be sent. Optional fields that are left out go back to their defaults.",
          requestBody: body("ProductCreate", { replace: { sku: "SKU-1001", name: "Walnut Desk, large", category: "furniture", price: 299, stock: 3 } }),
          responses: { 200: json(ref("ProductEnvelope"), "The replaced product."), 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound"), 409: response("Conflict"), 422: response("ValidationError") },
        },
        patch: {
          operationId: "updateProduct", tags: ["products"], summary: "Update some fields of a product",
          requestBody: body("ProductPatch", { price: { price: 21.9 } }),
          responses: { 200: json(ref("ProductEnvelope"), "The updated product."), 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound"), 409: response("Conflict"), 422: response("ValidationError") },
        },
        delete: {
          operationId: "deleteProduct", tags: ["products"], summary: "Delete a product and its reviews", security: BEARER_ONLY,
          responses: { 204: { description: "Deleted." }, 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound") },
        },
      },
      "/v1/products/{product_id}/reviews": {
        parameters: [parameter("ProductId")],
        get: {
          operationId: "listProductReviews", tags: ["reviews"], summary: "List a product's reviews",
          parameters: [parameter("Limit"), parameter("Cursor")],
          responses: { ...listResponses, 200: json(ref("ReviewList"), "A page of reviews."), 404: response("NotFound") },
        },
        post: {
          operationId: "createProductReview", tags: ["reviews"], summary: "Review a product",
          requestBody: body("ReviewCreate", { review: { rating: 4, author: "Sam", comment: "Sturdy and well finished.", store_id: 1 } }),
          responses: { 201: json(ref("ReviewEnvelope"), "The created review."), 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound"), 422: response("ValidationError") },
        },
      },
      "/v1/products/{product_id}/reviews/{review_id}": {
        parameters: [parameter("ProductId"), parameter("ReviewId")],
        get: {
          operationId: "getProductReview", tags: ["reviews"], summary: "Read a review",
          responses: { 200: json(ref("ReviewEnvelope"), "The review."), 401: response("Unauthorized"), 404: response("NotFound") },
        },
        delete: {
          operationId: "deleteProductReview", tags: ["reviews"], summary: "Delete a review", security: BEARER_ONLY,
          responses: { 204: { description: "Deleted." }, 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound") },
        },
      },
      "/v1/stores": {
        get: {
          operationId: "listStores", tags: ["stores"], summary: "List stores, optionally around a point",
          description: "With `lat` and `lon` only the stores within `radius_km` (5 km by default) are returned, nearest first, each with its `distance_km`. A coordinate without the other, or a radius without coordinates, is rejected.",
          parameters: [parameter("Limit"), parameter("Cursor"), parameter("Lat"), parameter("Lon"), parameter("RadiusKm")],
          responses: { ...listResponses, 200: json(ref("StoreList"), "A page of stores.") },
        },
        post: {
          operationId: "createStore", tags: ["stores"], summary: "Create a store",
          requestBody: body("StoreCreate", { store: { name: "Harbour Street", address: "12 Harbour Street", lat: 40.01, lon: -100.01, phone: "+1 555 0100" } }),
          responses: { 201: json(ref("StoreEnvelope"), "The created store."), 401: response("Unauthorized"), 403: response("Forbidden"), 409: response("Conflict"), 422: response("ValidationError") },
        },
      },
      "/v1/stores/{store_id}": {
        parameters: [parameter("StoreId")],
        get: {
          operationId: "getStore", tags: ["stores"], summary: "Read a store",
          responses: { 200: json(ref("StoreEnvelope"), "The store."), 401: response("Unauthorized"), 404: response("NotFound") },
        },
        put: {
          operationId: "replaceStore", tags: ["stores"], summary: "Replace a store",
          requestBody: body("StoreCreate", { replace: { name: "Harbour Street (moved)", address: "40 Harbour Street", lat: 40.02, lon: -100.02 } }),
          responses: { 200: json(ref("StoreEnvelope"), "The replaced store."), 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound"), 409: response("Conflict"), 422: response("ValidationError") },
        },
        patch: {
          operationId: "updateStore", tags: ["stores"], summary: "Update some fields of a store",
          requestBody: body("StorePatch", { phone: { phone: "+1 555 0199" } }),
          responses: { 200: json(ref("StoreEnvelope"), "The updated store."), 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound"), 409: response("Conflict"), 422: response("ValidationError") },
        },
        delete: {
          operationId: "deleteStore", tags: ["stores"], summary: "Delete a store", security: BEARER_ONLY,
          responses: { 204: { description: "Deleted." }, 401: response("Unauthorized"), 403: response("Forbidden"), 404: response("NotFound") },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "`admin-token` may do everything; `read-token` only reads." },
        apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "`demo-key`. Accepted everywhere except DELETE." },
      },
      parameters: {
        Limit: { name: "limit", in: "query", required: false, description: "Page size.", schema: { type: "integer", minimum: 1, maximum: 100, default: 20, example: 10 } },
        Cursor: { name: "cursor", in: "query", required: false, description: "Opaque cursor taken from `meta.next_cursor` of the previous page.", schema: { type: "string", example: "eyJvZmZzZXQiOjJ9" } },
        Q: { name: "q", in: "query", required: false, description: "Case-insensitive text search over name and description.", schema: { type: "string", minLength: 1, example: "lamp" } },
        Category: { name: "category", in: "query", required: false, description: "Exact category.", schema: { type: "string", minLength: 1, example: "lighting" } },
        Sku: { name: "sku", in: "query", required: false, description: "Exact SKU: zero or one product.", schema: { type: "string", minLength: 1, example: "SKU-0001" } },
        Lat: { name: "lat", in: "query", required: false, description: "Latitude of the centre. Requires `lon`.", schema: { type: "number", minimum: -90, maximum: 90, example: 40 } },
        Lon: { name: "lon", in: "query", required: false, description: "Longitude of the centre. Requires `lat`.", schema: { type: "number", minimum: -180, maximum: 180, example: -100 } },
        RadiusKm: { name: "radius_km", in: "query", required: false, description: "Search radius around `lat`/`lon`. Requires both.", schema: { type: "number", exclusiveMinimum: 0, maximum: 100, default: 5, example: 5 } },
        ProductId: { name: "product_id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
        StoreId: { name: "store_id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
        ReviewId: { name: "review_id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
      },
      responses: {
        Unauthorized: problemResponse("No credential, an unknown one, or one this operation does not accept."),
        Forbidden: problemResponse("The credential is valid but may not do this."),
        NotFound: problemResponse("The resource does not exist."),
        Conflict: problemResponse("The natural key is already taken."),
        ValidationError: problemResponse("The request is not valid: a parameter out of range, a corrupt cursor, or a body with missing or wrong fields."),
      },
      schemas: {
        Problem: {
          type: "object", description: "RFC 9457 Problem Details.",
          required: ["type", "title", "status", "detail"],
          properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" } },
          additionalProperties: false,
        },
        Health: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["ok"] } }, additionalProperties: false },
        ListMeta: { type: "object", required: ["next_cursor", "limit"], properties: { next_cursor: { type: ["string", "null"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
        ListLinks: { type: "object", required: ["next"], properties: { next: { type: ["string", "null"], description: "The next page, relative to the server." } }, additionalProperties: false },
        Product: {
          type: "object",
          required: ["product_id", "sku", "name", "description", "category", "price", "stock"],
          properties: {
            product_id: { type: "integer", minimum: 1, readOnly: true },
            sku: { type: "string", minLength: 1, maxLength: 64 },
            name: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 2000 },
            category: { type: "string", minLength: 1, maxLength: 64 },
            price: { type: "number", minimum: 0 },
            stock: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
        ProductCreate: {
          type: "object",
          required: ["sku", "name", "category", "price"],
          properties: {
            sku: { type: "string", minLength: 1, maxLength: 64, example: "SKU-1001" },
            name: { type: "string", minLength: 1, maxLength: 200, example: "Walnut Desk" },
            description: { type: ["string", "null"], maxLength: 2000 },
            category: { type: "string", minLength: 1, maxLength: 64, example: "furniture" },
            price: { type: "number", minimum: 0, example: 249 },
            stock: { type: "integer", minimum: 0, default: 0 },
          },
        },
        ProductPatch: {
          type: "object", minProperties: 1, description: "At least one writable field.",
          properties: {
            price: { type: "number", minimum: 0, example: 21.9 },
            sku: { type: "string", minLength: 1, maxLength: 64 },
            name: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 2000 },
            category: { type: "string", minLength: 1, maxLength: 64 },
            stock: { type: "integer", minimum: 0 },
          },
        },
        ProductBulkRequest: {
          type: "object", required: ["records"],
          properties: { records: { type: "array", minItems: 1, maxItems: 100, items: ref("ProductCreate") } },
        },
        ProductEnvelope: { type: "object", required: ["data"], properties: { data: ref("Product") }, additionalProperties: false },
        ProductList: {
          type: "object", required: ["data", "meta", "links"],
          properties: { data: { type: "array", items: ref("Product") }, meta: ref("ListMeta"), links: ref("ListLinks") },
          additionalProperties: false,
        },
        BulkResult: {
          type: "object", required: ["created", "updated", "unchanged"],
          properties: { created: { type: "integer", minimum: 0 }, updated: { type: "integer", minimum: 0 }, unchanged: { type: "integer", minimum: 0 } },
          additionalProperties: false,
        },
        BulkResultEnvelope: { type: "object", required: ["data"], properties: { data: ref("BulkResult") }, additionalProperties: false },
        Store: {
          type: "object",
          required: ["store_id", "name", "address", "lat", "lon", "phone"],
          properties: {
            store_id: { type: "integer", minimum: 1, readOnly: true },
            name: { type: "string", minLength: 1, maxLength: 120 },
            address: { type: "string", minLength: 1, maxLength: 200 },
            lat: { type: "number", minimum: -90, maximum: 90 },
            lon: { type: "number", minimum: -180, maximum: 180 },
            phone: { type: ["string", "null"], maxLength: 32 },
            distance_km: { type: "number", minimum: 0, readOnly: true, description: "Only in a geographic search." },
          },
          additionalProperties: false,
        },
        StoreCreate: {
          type: "object",
          required: ["name", "address", "lat", "lon"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120, example: "Harbour Street" },
            address: { type: "string", minLength: 1, maxLength: 200, example: "12 Harbour Street" },
            lat: { type: "number", minimum: -90, maximum: 90, example: 40.01 },
            lon: { type: "number", minimum: -180, maximum: 180, example: -100.01 },
            phone: { type: ["string", "null"], maxLength: 32 },
          },
        },
        StorePatch: {
          type: "object", minProperties: 1, description: "At least one writable field.",
          properties: {
            phone: { type: ["string", "null"], maxLength: 32, example: "+1 555 0199" },
            name: { type: "string", minLength: 1, maxLength: 120 },
            address: { type: "string", minLength: 1, maxLength: 200 },
            lat: { type: "number", minimum: -90, maximum: 90 },
            lon: { type: "number", minimum: -180, maximum: 180 },
          },
        },
        StoreEnvelope: { type: "object", required: ["data"], properties: { data: ref("Store") }, additionalProperties: false },
        StoreList: {
          type: "object", required: ["data", "meta", "links"],
          properties: { data: { type: "array", items: ref("Store") }, meta: ref("ListMeta"), links: ref("ListLinks") },
          additionalProperties: false,
        },
        Review: {
          type: "object",
          required: ["id", "product_id", "store_id", "rating", "author", "comment"],
          properties: {
            id: { type: "integer", minimum: 1, readOnly: true },
            product_id: { type: "integer", minimum: 1, readOnly: true },
            store_id: { type: ["integer", "null"], minimum: 1, description: "The store the product was bought at, if any." },
            rating: { type: "integer", minimum: 1, maximum: 5 },
            author: { type: "string", minLength: 1, maxLength: 80 },
            comment: { type: "string", maxLength: 2000 },
          },
          additionalProperties: false,
        },
        ReviewCreate: {
          type: "object",
          required: ["rating", "author"],
          properties: {
            rating: { type: "integer", minimum: 1, maximum: 5, example: 4 },
            author: { type: "string", minLength: 1, maxLength: 80, example: "Sam" },
            comment: { type: "string", maxLength: 2000, default: "" },
            store_id: { type: ["integer", "null"], minimum: 1, description: "Must be an existing store." },
          },
        },
        ReviewEnvelope: { type: "object", required: ["data"], properties: { data: ref("Review") }, additionalProperties: false },
        ReviewList: {
          type: "object", required: ["data", "meta", "links"],
          properties: { data: { type: "array", items: ref("Review") }, meta: ref("ListMeta"), links: ref("ListLinks") },
          additionalProperties: false,
        },
      },
    },
  };
}
