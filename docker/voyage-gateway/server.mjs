import { createServer } from "node:http";

const API_KEY = process.env.VOYAGE_API_KEY;
const UPSTREAM = process.env.UPSTREAM_URL ?? "https://api.voyageai.com/v1";
const PORT = Number(process.env.PORT ?? 8080);

if (!API_KEY) {
  console.error("VOYAGE_API_KEY is required");
  process.exit(1);
}

createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/v1/embeddings")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const upstream = await fetch(`${UPSTREAM}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      body,
    });
    res.writeHead(upstream.status, { "content-type": "application/json" });
    res.end(await upstream.text());
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
}).listen(PORT, "0.0.0.0", () => console.log(`voyage gateway listening on :${PORT}`));
