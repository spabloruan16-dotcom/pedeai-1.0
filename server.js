const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 4173);
const root = __dirname;
const dataDir = path.join(root, "server");
const stateFile = path.join(dataDir, "data.json");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function ensureStateFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify({
      merchant: null,
      shop: null,
      categories: [],
      products: [],
      orders: [],
      ratings: [],
      messages: [],
      delivery: { pickup: true, delivery: true, pickupMinutes: 20, deliveryMinutes: 45 },
      printerConfig: {
        mode: "cabo",
        deviceName: "Impressora térmica padrão",
        copies: 1,
        autoPrint: true,
        includeCustomer: true,
        includePhone: true,
        includeAddress: true,
        includeItems: true,
        includeNotes: true,
        includePayment: true,
        includeFooter: true,
        footerText: "Obrigado pela preferência!"
      },
      printers: [{ id: "default", name: "Impressora térmica local", type: "cabo", status: "Conectada", default: true }]
    }, null, 2));
  }
}

function readStateFile() {
  try {
    ensureStateFile();
    const raw = fs.readFileSync(stateFile, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStateFile(data) {
  ensureStateFile();
  fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
}

function mergeState(current, incoming) {
  const merged = { ...current, ...incoming };
  for (const collection of ["orders", "messages", "ratings", "categories", "products"]) {
    if (!Array.isArray(current?.[collection]) || !Array.isArray(incoming?.[collection])) continue;
    const key = collection === "categories" ? (item) => String(item) : (item) => String(item.id || JSON.stringify(item));
    const items = new Map(current[collection].map((item) => [key(item), item]));
    incoming[collection].forEach((item) => items.set(key(item), item));
    merged[collection] = [...items.values()];
  }
  return merged;
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true, service: "pedeia" }));
    return;
  }

  if (pathname === "/api/state") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(readStateFile()));
    return;
  }

  if (pathname === "/api/save-state") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const current = readStateFile();
        writeStateFile(mergeState(current, parsed));
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "Estado invalido" }));
      }
    });
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Acesso negado");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Pagina nao encontrada");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}).listen(port, "0.0.0.0", () => {
  ensureStateFile();
  console.log(`PedeIA em http://localhost:${port}`);
});
