import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { rewriteHtmlForPath } from "./seo";

export function serveStatic(app: Express) {
  const distPath = path.resolve(
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(new URL(import.meta.url).pathname),
    "public"
  );
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", async (req, res, next) => {
    try {
      const html = await fs.promises.readFile(
        path.resolve(distPath, "index.html"),
        "utf-8",
      );
      res
        .status(200)
        .set({ "Content-Type": "text/html" })
        .end(rewriteHtmlForPath(html, req.originalUrl.split("?")[0]));
    } catch (e) {
      next(e);
    }
  });
}
